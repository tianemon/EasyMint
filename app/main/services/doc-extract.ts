/**
 * 文档文本抽取 — 覆盖 Read 工具读不了的二进制文档格式（pdf/docx/xlsx/pptx 等）。
 *
 * 跨平台（mac/win/linux）：解析器全部用纯 JS npm 包，按需 require——
 * 不进 main.cjs bundle（build:main 里 external），运行时才加载对应格式的解析器，
 * 不影响启动与包体。doc/rtf（老二进制格式）仅 macOS 用系统自带 textutil，其余平台标注暂不支持。
 *
 * 调用方：增强 Read 工具（enhanced-read.ts）——模型 Read 一个文档时自动抽取文本返回。
 */

import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extname, basename } from "node:path";
import os from "node:os";
import type * as ExcelJSType from "exceljs";

const execFileAsync = promisify(execFile);

/** 抽取文本上限（防撑爆上下文）；超出截断并在文本后标注 */
const MAX_TEXT_CHARS = 100_000;

/** 所有文档格式的大小上限（防超大文件直接读入内存拖垮进程） */
const MAX_DOC_BYTES = 100 * 1024 * 1024;
/** xlsx 特设更严上限：解析不可信 xlsx 有原型污染/ReDoS/解压炸弹面（CVE-2023-30533/CVE-2024-22363），收窄输入 */
const MAX_XLSX_BYTES = 50 * 1024 * 1024;

export interface DocExtractOk {
  ok: true;
  text: string;
  format: string;
  truncated: boolean;
}

export interface DocExtractFail {
  ok: false;
  message: string;
}

export type DocExtractResult = DocExtractOk | DocExtractFail | null;

function extOf(filePath: string): string {
  return extname(filePath).slice(1).toLowerCase();
}

/** 需要走抽取的二进制文档格式（其余交给原生 Read 读文本） */
const DOC_FORMATS: Record<string, string> = {
  pdf: "pdf",
  docx: "docx",
  doc: "doc",
  rtf: "rtf",
  xls: "xlsx",
  xlsx: "xlsx",
  ppt: "ppt", // 老二进制 .ppt 与新版 .pptx 分开——OLE2 无纯 JS 解析器,单独引导
  pptx: "pptx",
  odt: "odf",
  ods: "odf",
  odp: "odf",
};

/**
 * 按内容签名嗅探文档格式——让「自动检测」名副其实（描述即真实）：
 *   %PDF → pdf；{\\rtf → rtf；PK(zip) → 按扩展名区分 docx/xlsx/pptx/odt…；OLE2 → doc/xls。
 * 嗅探无结论时由调用方回退到扩展名路由。
 */
function sniffDocFormat(filePath: string, ext: string): string | undefined {
  try {
    // 只读头部 8 字节嗅探（openSync/readSync——避免 readFileSync 整文件读入内存）
    const fd = openSync(filePath, "r");
    let head: Buffer;
    try {
      head = Buffer.alloc(8);
      readSync(fd, head, 0, 8, 0);
    } finally {
      closeSync(fd);
    }
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf";
    if (head[0] === 0x7b && head[1] === 0x5c && head[2] === 0x72 && head[3] === 0x74 && head[4] === 0x66) return "rtf";
    if (head[0] === 0x50 && head[1] === 0x4b) {
      // zip 家族按扩展名区分
      return DOC_FORMATS[ext] ?? undefined;
    }
    if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
      // OLE2（老 doc/xls/ppt）
      return ext === "doc" ? "doc" : ext === "xls" ? "xlsx" : ext === "ppt" ? "ppt" : undefined;
    }
  } catch { /* 读取失败交给扩展名路由 */ }
  return undefined;
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false };
  return {
    text: text.slice(0, MAX_TEXT_CHARS) + `\n\n[内容过长，已截断到 ${MAX_TEXT_CHARS} 字符]`,
    truncated: true,
  };
}

/** 从 OOXML/ODF 的 XML 里抽取 <a:t>…</a:t> 文本（pptx/odt/ods/odp 通用） */
function extractXmlText(xml: string): string {
  const parts: string[] = [];
  const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<text:p(?:\s[^>]*)?>([\s\S]*?)<\/text:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    if (raw) parts.push(raw.replace(/<[^>]+>/g, "").trim());
  }
  return parts.join("\n");
}

/** 解压 zip 并抽取指定文件列表的文本（pptx/odt/ods/odp） */
async function extractZipText(filePath: string, wanted: string[], stripTags: boolean): Promise<string> {
  const JSZip = require("jszip") as any;
  const data = readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);
  const texts: string[] = [];
  for (const name of Object.keys(zip.files)) {
    if (!wanted.some((w) => name.startsWith(w))) continue;
    const content = await zip.files[name]!.async("string");
    if (stripTags) {
      const t = extractXmlText(content);
      if (t) texts.push(t);
    } else {
      texts.push(content);
    }
  }
  return texts.join("\n\n");
}

/** 抽取 pptx 每页文本:按 slide 序号排序(勿依赖 zip 条目顺序——slide10 可能在 slide2 前) +
 *  每页加「--- 第 N 页 ---」分隔——模型按页理解长课件,不再是一坨无边界文本 */
async function extractPptxText(filePath: string): Promise<string> {
  const JSZip = require("jszip") as any;
  const data = readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);
  const slides: Array<{ n: number; text: string }> = [];
  for (const name of Object.keys(zip.files)) {
    const m = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name);
    if (!m) continue;
    const content = await zip.files[name]!.async("string");
    const t = extractXmlText(content);
    if (t) slides.push({ n: Number(m[1]), text: t });
  }
  slides.sort((a, b) => a.n - b.n);
  if (slides.length === 0) return "";
  return slides.map((s) => `--- 第 ${s.n} 页 ---\n${s.text}`).join("\n\n");
}

/** exceljs 单元格值 → 文本（覆盖日期/公式/富文本/超链接/错误值等对象形态） */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (value instanceof Date) return value.toISOString();
  const rec = value as Record<string, unknown>;
  // 富文本 [{ text: "a" }, ...]
  if (Array.isArray(rec.richText)) {
    return rec.richText.map((r) => String((r as { text?: unknown }).text ?? "")).join("");
  }
  // 错误值（如 #DIV/0!）
  if (rec.error) return String(rec.error);
  // 公式单元格 → 显示计算结果
  if (rec.result !== undefined && rec.result !== null && typeof rec.result !== "object") return String(rec.result);
  // 超链接/富文本等带显示文本的对象
  if (rec.text !== undefined) return String(rec.text);
  return String(rec);
}

/** CSV 字段转义（值含逗号/引号/换行时加引号） */
function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 工作表逐行转 CSV 文本（对齐旧 xlsx 库 sheet_to_csv 的输出语义；跳过空行、去尾空列） */
function worksheetToCsvLines(ws: ExcelJSType.Worksheet): string[] {
  const lines: string[] = [];
  ws.eachRow((row) => {
    const vals: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      vals.push(csvEscape(cellToText(row.getCell(c).value)));
    }
    while (vals.length > 0 && vals[vals.length - 1] === "") vals.pop();
    if (vals.some((v) => v !== "")) lines.push(vals.join(","));
  });
  return lines;
}

/**
 * 抽取文档文本。返回：
 *  - DocExtractOk：抽取成功
 *  - DocExtractFail：格式已知但解析失败（如系统缺依赖）
 *  - null：非文档格式（交给原生 Read 按文本读）
 */
export async function extractDocumentText(filePath: string): Promise<DocExtractResult> {
  const ext = extOf(filePath);
  if (!existsSync(filePath)) return { ok: false, message: `文件不存在: ${filePath}` };
  // 内容签名优先（描述声称"按内容自动检测"），扩展名兜底
  const format = sniffDocFormat(filePath, ext) ?? DOC_FORMATS[ext] ?? null;
  if (!format) return null;
  // 解析前大小上限：拒绝超大文件（xlsx 更严——解析不可信电子表格的已知 CVE 面）
  const capBytes = format === "xlsx" ? MAX_XLSX_BYTES : MAX_DOC_BYTES;
  try {
    if (statSync(filePath).size > capBytes) {
      return {
        ok: false,
        message: `文件超过大小上限（${Math.round(capBytes / 1024 / 1024)}MB），已拒绝解析`,
      };
    }
  } catch {
    return { ok: false, message: "读取文件信息失败" };
  }
  try {
    let raw = "";
    switch (format) {
      case "pdf": {
        // pdf-parse v2：PDFParse 类 + getText()；按需 require（external，运行时才加载）
        const pdfMod = require("pdf-parse") as {
          PDFParse: new (opts: { data: Buffer }) => {
            getText(): Promise<{ text: string }>;
            destroy(): Promise<void>;
          };
        };
        const parser = new pdfMod.PDFParse({ data: readFileSync(filePath) });
        try {
          const result = await parser.getText();
          raw = result.text ?? "";
        } finally {
          await parser.destroy().catch(() => {});
        }
        break;
      }
      case "docx": {
        // mammoth 是 CJS，用 require（external，运行时才加载）
        const mammoth = require("mammoth") as {
          extractRawText: (o: { path: string }) => Promise<{ value: string }>;
        };
        const result = await mammoth.extractRawText({ path: filePath });
        raw = result.value ?? "";
        break;
      }
      case "xlsx": {
        // 老二进制 .xls（OLE2）exceljs 只读 OOXML .xlsx——给可执行引导（对齐 .ppt 处理）
        if (ext === "xls") {
          return {
            ok: false,
            message: "老版 .xls 格式暂不支持直接解析。请用 WPS/Office 打开后「另存为」.xlsx，再重新发送或读取（步骤：打开文件 → 文件 → 另存为 → 选择 .xlsx 格式）",
          };
        }
        // exceljs（MIT、活跃维护）替代 xlsx@0.18.5——后者 CVE-2023-30533（原型污染）/CVE-2024-22363（ReDoS）无 npm 修复版
        const ExcelJS = require("exceljs") as typeof import("exceljs");
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.readFile(filePath);
        const lines: string[] = [];
        for (const ws of wb.worksheets) {
          lines.push(`[工作表: ${ws.name}]`);
          lines.push(...worksheetToCsvLines(ws));
        }
        raw = lines.join("\n");
        break;
      }
      case "pptx": {
        raw = await extractPptxText(filePath);
        break;
      }
      case "ppt": {
        // 老二进制 .ppt(OLE2):无纯 JS 解析器(仅 Apache POI/LibreOffice 可读)——给可执行引导而非模型自行纠结
        return {
          ok: false,
          message: "老版 .ppt 格式暂不支持直接解析。请用 WPS/Office 打开后「另存为」.pptx，再重新发送或读取（步骤：打开文件 → 文件 → 另存为 → 选择 .pptx 格式）",
        };
      }
      case "odf": {
        raw = await extractZipText(filePath, ["content.xml"], true);
        break;
      }
      case "doc":
      case "rtf": {
        // 老二进制格式无成熟 JS 解析器：macOS 用系统 textutil，其余平台暂不支持
        if (os.platform() !== "darwin") {
          return { ok: false, message: `暂不支持 ${format.toUpperCase()} 格式解析（当前平台无可用解析器），可尝试转成 docx/pdf/txt 后重新上传` };
        }
        const { stdout } = await execFileAsync("/usr/bin/textutil", ["-convert", "txt", "-stdout", filePath], { maxBuffer: 10 * 1024 * 1024 });
        raw = stdout;
        break;
      }
      default:
        return null;
    }
    if (!raw || !raw.trim()) {
      return { ok: false, message: `未能从 ${basename(filePath)} 中提取到文本（可能是扫描件/纯图片 PDF，无文字层）` };
    }
    const { text, truncated } = truncate(raw);
    return { ok: true, text, format, truncated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `解析 ${basename(filePath)} 失败: ${msg.slice(0, 300)}` };
  }
}
