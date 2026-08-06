/**
 * 聊天区 diff 语法高亮
 * 用 monaco 的 Monarch tokenizer 给 diff 变更行做 token 级着色(零新依赖)。
 * 同步 tokenize 前需先异步触发语言加载(warmup),见 warmupLanguage()。
 */

import * as monaco from "monaco-editor";

// 按需注册语言(monaco 懒加载,需手动 import register 模块)
// 路径走 monaco exports "./*" → "./esm/vs/*.js",故省略 esm/vs 前缀
const LANGUAGE_MODULES: Record<string, () => Promise<unknown>> = {
  typescript: () => import("monaco-editor/languages/definitions/typescript/register.js"),
  javascript: () => import("monaco-editor/languages/definitions/javascript/register.js"),
  css: () => import("monaco-editor/languages/definitions/css/register.js"),
  html: () => import("monaco-editor/languages/definitions/html/register.js"),
  json: () => import("monaco-editor/languages/features/json/register.js"),
  markdown: () => import("monaco-editor/languages/definitions/markdown/register.js"),
  python: () => import("monaco-editor/languages/definitions/python/register.js"),
  go: () => import("monaco-editor/languages/definitions/go/register.js"),
  rust: () => import("monaco-editor/languages/definitions/rust/register.js"),
  java: () => import("monaco-editor/languages/definitions/java/register.js"),
  cpp: () => import("monaco-editor/languages/definitions/cpp/register.js"),
  csharp: () => import("monaco-editor/languages/definitions/csharp/register.js"),
  shell: () => import("monaco-editor/languages/definitions/shell/register.js"),
  xml: () => import("monaco-editor/languages/definitions/xml/register.js"),
  yaml: () => import("monaco-editor/languages/definitions/yaml/register.js"),
  ini: () => import("monaco-editor/languages/definitions/ini/register.js"),
  dockerfile: () => import("monaco-editor/languages/definitions/dockerfile/register.js"),
};

// 扩展名 → monaco languageId
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", cts: "typescript", mts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  css: "css", scss: "css", less: "css",
  html: "html", htm: "html", vue: "html",
  json: "json", jsonc: "json",
  md: "markdown", markdown: "markdown",
  py: "python", pyw: "python",
  go: "go",
  rs: "rust",
  java: "java",
  c: "cpp", h: "cpp", cpp: "cpp", cc: "cpp", hpp: "cpp",
  cs: "csharp",
  sh: "shell", bash: "shell", zsh: "shell",
  xml: "xml", svg: "xml", mxml: "xml",
  yml: "yaml", yaml: "yaml",
  ini: "ini", cfg: "ini", conf: "ini", properties: "ini",
  dockerfile: "dockerfile",
};

// token 类型 → CSS 变量(monaco token 为 类型.语言 格式,按前缀匹配)
const TOKEN_COLOR: Record<string, string> = {
  keyword: "var(--color-code-kw)",
  string: "var(--color-code-str)",
  comment: "var(--color-code-cm)",
  number: "var(--color-code-num)",
  type: "var(--color-code-type)",
  function: "var(--color-code-fn)",
};

function cssVarForTokenType(tokenType: string): string | undefined {
  if (tokenType.startsWith("comment")) return TOKEN_COLOR.comment;
  if (tokenType.startsWith("string") || tokenType.startsWith("attribute.value")) return TOKEN_COLOR.string;
  if (tokenType.startsWith("number") || tokenType.startsWith("constant.numeric") || tokenType.startsWith("attribute.value.number")) return TOKEN_COLOR.number;
  if (tokenType.startsWith("keyword") || tokenType.startsWith("storage.type")) return TOKEN_COLOR.keyword;
  if (tokenType.startsWith("type") || tokenType.startsWith("tag")) return TOKEN_COLOR.type;
  if (tokenType.startsWith("function") || tokenType.startsWith("entity.name.function") || tokenType.startsWith("attribute.name")) return TOKEN_COLOR.function;
  return undefined;
}

// 已加载语言缓存
const loadedLanguages = new Set<string>();
// warmup promise 缓存
const warmupPromises = new Map<string, Promise<void>>();

export function inferLang(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  return EXT_TO_LANG[ext];
}

/**
 * 确保语言已注册并加载 tokenizer。monaco 同步 tokenize 前必须异步触发语言加载。
 * 幂等:同语言并发调用只跑一次。
 */
export function warmupLanguage(lang: string): Promise<void> {
  const existing = warmupPromises.get(lang);
  if (existing) return existing;
  const p = (async () => {
    if (loadedLanguages.has(lang)) return;
    const mod = LANGUAGE_MODULES[lang];
    if (mod) {
      await mod();
      // 语言注册后,colorize 内部 await getOrCreate 触发 tokenizer 加载
      await monaco.editor.colorize("", lang, {});
    }
    loadedLanguages.add(lang);
  })();
  warmupPromises.set(lang, p);
  return p;
}

/**
 * 返回 token 分段 [{ text, color }],color 为 CSS var 或 undefined(默认色)。
 * 语言未知/加载失败 → 返回 null(调用方回退纯红绿)。
 */
export async function tokenizeLine(code: string, lang: string): Promise<Array<{ text: string; color?: string }> | null> {
  try {
    await warmupLanguage(lang);
    const tokens = tokenizeCode(code, lang);
    return tokensToSegments(code, tokens);
  } catch {
    return null;
  }
}

/**
 * 批量 tokenize 多行代码(同语言):一次 warmup,逐行返回分段。
 * 比逐行调 tokenizeLine 少 N 次 warmup 判断。
 */
export async function tokenizeLines(
  codes: string[],
  lang: string,
): Promise<Array<Array<{ text: string; color?: string }> | null>> {
  try {
    await warmupLanguage(lang);
    return codes.map((c) => tokensToSegments(c, tokenizeCode(c, lang)));
  } catch {
    return codes.map(() => null);
  }
}

/** 单行 tokenize:diff 每行就是一行代码,防止 comment/string token 跨行吞后续内容 */
function tokenizeCode(code: string, lang: string): monaco.Token[] {
  const codeLine = code.replace(/\n/g, " ");
  const lines = monaco.editor.tokenize(codeLine, lang);
  return lines[0] ?? [];
}

function tokensToSegments(code: string, tokens: monaco.Token[]): Array<{ text: string; color?: string }> {
  // monaco Token 只有 offset,长度 = 下一个 token offset - 当前 offset
  const segments: Array<{ text: string; color?: string }> = [];
  let prevEnd = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const end = i + 1 < tokens.length ? tokens[i + 1]!.offset : code.length;
    const color = cssVarForTokenType(tok.type);
    if (tok.offset > prevEnd) {
      segments.push({ text: code.slice(prevEnd, tok.offset) });
    }
    segments.push({ text: code.slice(tok.offset, end), color });
    prevEnd = end;
  }
  if (prevEnd < code.length) {
    segments.push({ text: code.slice(prevEnd) });
  }
  // 相邻同色合并
  const merged: Array<{ text: string; color?: string }> = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.color === seg.color) last.text += seg.text;
    else merged.push(seg);
  }
  return merged;
}
