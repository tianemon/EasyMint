/**
 * 文档文本抽取 — 覆盖 Read 工具读不了的二进制文档格式（pdf/docx/xlsx/pptx 等）。
 *
 * 跨平台（mac/win/linux）：解析器全部用纯 JS npm 包，按需 require——
 * 不进 main.cjs bundle（build:main 里 external），运行时才加载对应格式的解析器，
 * 不影响启动与包体。doc/rtf（老二进制格式）仅 macOS 用系统自带 textutil，其余平台标注暂不支持。
 *
 * 调用方：增强 Read 工具（enhanced-read.ts）——模型 Read 一个文档时自动抽取文本返回。
 */

import { readFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extname, basename } from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

/** 抽取文本上限（防撑爆上下文）；超出截断并在文本后标注 */
const MAX_TEXT_CHARS = 100_000;

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
  ppt: "pptx",
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
    const head = readFileSync(filePath).subarray(0, 8);
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return "pdf";
    if (head[0] === 0x7b && head[1] === 0x5c && head[2] === 0x72 && head[3] === 0x74 && head[4] === 0x66) return "rtf";
    if (head[0] === 0x50 && head[1] === 0x4b) {
      // zip 家族按扩展名区分
      return DOC_FORMATS[ext] ?? undefined;
    }
    if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
      // OLE2（老 doc/xls/ppt）
      return ext === "doc" ? "doc" : ext === "xls" ? "xlsx" : undefined;
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

/**
 * 抽取文档文本。返回：
 *  - DocExtractOk：抽取成功
 *  - DocExtractFail：格式已知但解析失败（如系统缺依赖）
 *  - null：非文档格式（交给原生 Read 按文本读）
 */
export async function extractDocumentText(filePath: string): Promise<DocExtractResult> {
  const ext = extOf(filePath);
  // 内容签名优先（描述声称"按内容自动检测"），扩展名兜底
  const format = sniffDocFormat(filePath, ext) ?? DOC_FORMATS[ext] ?? null;
  if (!format) return null;
  if (!existsSync(filePath)) return { ok: false, message: `文件不存在: ${filePath}` };
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
        const XLSX = require("xlsx") as typeof import("xlsx");
        const wb = XLSX.readFile(filePath, { cellDates: true });
        const lines: string[] = [];
        for (const name of wb.SheetNames) {
          const ws = wb.Sheets[name]!;
          const csv = XLSX.utils.sheet_to_csv(ws);
          lines.push(`[工作表: ${name}]\n${csv}`);
        }
        raw = lines.join("\n\n");
        break;
      }
      case "pptx": {
        raw = await extractZipText(filePath, ["ppt/slides/slide"], true);
        break;
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
