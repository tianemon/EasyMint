/**
 * 增强 Read 工具 — 让模型 Read 二进制文档（pdf/docx/xlsx/pptx 等）时自动抽取文本。
 *
 * 设计（对齐 Pi SDK 扩展机制）：SDK 的 read 工具支持通过 operations 定制读取层
 * （ReadOperations：readFile/access/detectImageMimeType），但文档抽取需要在
 * execute 层拦截（原生文本路径是 buffer.toString("utf-8")，二进制会乱码）。
 * 因此按 EM 增强 bash/edit 的同一模式：包装原生 read 定义——文档格式走 doc-extract，
 * 其余（文本/图片/offset/limit/截断/渲染）全部委托原生，行为零回归。
 */

import { extractDocumentText } from "./doc-extract";

export async function createEnhancedReadTool(
  cwd: string,
  codingTools: any[],
): Promise<any> {
  const native = codingTools.find((t) => t?.name === "read");
  if (!native) {
    // 原生 read 不在列表（异常情况）：不阻断，返回空对象由上层过滤
    return null;
  }

  const nativeExecute = native.execute as ((...args: any[]) => Promise<any>) | undefined;

  return {
    ...native,
    // 描述即能力契约：模型 100% 按描述判断工具边界。原生描述只写 text+images，
    // PDF 等不在白名单 → 模型预判失败就不会尝试。扩充格式清单 + 兜底策略句，
    // 让模型知道「不确定也可以直接试，失败返回明确错误，不会乱码污染上下文」。
    description:
      `Read the contents of a file. Supports text files, images (jpg, png, gif, webp, bmp), `
      + `and common documents (pdf, docx, xlsx, pptx, csv, rtf) — document formats are `
      + `auto-detected (by content signature) and parsed to text. Images are sent as attachments. `
      + `If you are unsure whether a format is readable, try reading it directly: failures return `
      + `a clear error message and never produce garbled content. `
      + `For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). `
      + `Use offset/limit for large files. When you need the full file, continue with offset until complete.`,
    async execute(toolCallId: string, args: any, signal?: AbortSignal, onUpdate?: any, ctx?: any) {
      // 文档格式 → 抽取文本返回（路径可能是相对 cwd 的）
      const rawPath = typeof args?.path === "string" ? args.path : "";
      if (rawPath) {
        const absolute = rawPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rawPath)
          ? rawPath
          : require("node:path").resolve(cwd, rawPath);
        const result = await extractDocumentText(absolute);
        if (result && result.ok) {
          const note = `Read document [${result.format}${result.truncated ? ", 已截断" : ""}]\n`;
          return { content: [{ type: "text" as const, text: note + result.text }] };
        }
        if (result && !result.ok) {
          // 格式已知但解析失败 → 明确报错，让模型如实告知用户（不静默）
          return { content: [{ type: "text" as const, text: result.message }] };
        }
      }
      // 非文档格式 → 完整委托原生 read（文本/图片/截断/offset/limit 行为不变）
      if (nativeExecute) return nativeExecute(toolCallId, args, signal, onUpdate, ctx);
      return { content: [{ type: "text" as const, text: "read 工具不可用" }] };
    },
  };
}
