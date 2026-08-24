#!/usr/bin/env node
/**
 * extract-session.js — 从 Claude Code JSONL 会话文件中提取对话核心内容
 *
 * 默认只输出 user/assistant 的纯文本对话，跳过思考块、工具调用、系统消息
 * 等噪音，最大限度节省 token。适合让 AI 快速读取一段历史会话。
 *
 * 用法：
 *   node scripts/extract-session.js <jsonl文件> [选项]
 *
 * 选项：
 *   --thinking        包含思考块（thinking）
 *   --tools           包含工具调用（tool_use / tool_result）
 *   --all             包含所有内容（thinking + tools + 其他元数据行）
 *   --max-chars N     截断输出到 N 字符（默认 100000）
 *   --no-truncate     不截断（输出全部内容，慎用）
 *   --role-prefix     输出带「用户：/AI：」前缀（默认开启，--no-role-prefix 关闭）
 *   -o, --output 文件  写入文件而非 stdout
 *   -h, --help        显示帮助
 *
 * 示例：
 *   node scripts/extract-session.js ~/.claude/projects/-Foo-Bar/abc.jsonl
 *   node scripts/extract-session.js abc.jsonl --thinking --tools
 *   node scripts/extract-session.js abc.jsonl -o out.txt --max-chars 50000
 */

import fs from "fs";
import path from "path";

// ─── 参数解析 ────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    file: null,
    thinking: false,
    tools: false,
    all: false,
    maxChars: 100000,
    truncate: true,
    rolePrefix: true,
    output: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--thinking": opts.thinking = true; break;
      case "--tools": opts.tools = true; break;
      case "--all": opts.all = true; opts.thinking = true; opts.tools = true; break;
      case "--max-chars":
        opts.maxChars = parseInt(argv[++i], 10);
        if (isNaN(opts.maxChars) || opts.maxChars <= 0) opts.maxChars = 100000;
        break;
      case "--no-truncate": opts.truncate = false; break;
      case "--no-role-prefix": opts.rolePrefix = false; break;
      case "--role-prefix": opts.rolePrefix = true; break;
      case "-o": case "--output": opts.output = argv[++i]; break;
      case "-h": case "--help": opts.help = true; break;
      default:
        if (a.startsWith("-")) {
          console.error(`未知参数: ${a}`);
          process.exit(2);
        }
        if (!opts.file) opts.file = a;
        else { console.error("只能指定一个 JSONL 文件"); process.exit(2); }
    }
  }
  return opts;
}

// ─── 文本提取 ────────────────────────────────────────────

/** 提取 user 消息文本：字符串直接取；数组只取 text 块（可选 tool_result） */
function extractUserText(content, withTools) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") {
      const t = block.text.trim();
      if (t) parts.push(t);
    } else if (withTools && block.type === "tool_result") {
      const t = extractToolResult(block);
      if (t) parts.push(`[工具结果${block.is_error ? " (出错)" : ""}]\n${t}`);
    }
  }
  return parts.join("\n\n");
}

/** 提取 tool_result 内容（字符串或 text 块数组） */
function extractToolResult(block) {
  const c = block.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) {
    return c
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** 提取 assistant 消息文本：text 块（可选 thinking / tool_use） */
function extractAssistantText(content, withThinking, withTools) {
  if (!Array.isArray(content)) return "";

  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") {
      const t = block.text.trim();
      if (t) parts.push(t);
    } else if (withThinking && block.type === "thinking" && typeof block.thinking === "string") {
      const t = block.thinking.trim();
      if (t) parts.push(`[思考过程]\n${t}`);
    } else if (withTools && block.type === "tool_use" && typeof block.name === "string") {
      const input = block.input ? JSON.stringify(block.input) : "{}";
      // 工具入参可能很长，截断到 2000 字符
      const shown = input.length > 2000 ? input.slice(0, 2000) + "…" : input;
      parts.push(`[工具调用: ${block.name}]\n${shown}`);
    }
  }
  return parts.join("\n\n");
}

// ─── 主处理 ──────────────────────────────────────────────

function processFile(filePath, opts) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  const out = [];
  let skipped = 0;

  for (const line of lines) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (!msg || !msg.type) continue;

    const { type, message, isMeta } = msg;
    if (isMeta) continue;

    const content = message && message.content;

    if (type === "user") {
      const text = extractUserText(content, opts.tools);
      if (text) out.push(opts.rolePrefix ? `用户：${text}` : text);
    } else if (type === "assistant") {
      const text = extractAssistantText(content, opts.thinking, opts.tools);
      if (text) out.push(opts.rolePrefix ? `AI：${text}` : text);
    }
    // 其他类型（system/last-prompt/mode/attachment/...）默认跳过
  }

  let result = out.join("\n\n---\n\n");

  if (opts.truncate && result.length > opts.maxChars) {
    // 保留头部 30% + 尾部 70%，结论通常在会话后段
    const headChars = Math.floor(opts.maxChars * 0.3);
    const tailChars = opts.maxChars - headChars;
    const head = result.slice(0, headChars);
    const tail = result.slice(result.length - tailChars);
    const headCut = head.lastIndexOf("\n");
    const tailCut = tail.indexOf("\n");
    result =
      head.slice(0, headCut > 0 ? headCut : head.length) +
      `\n\n[内容已截断：原文 ${result.length} 字符，仅保留首尾共 ${opts.maxChars} 字符]\n\n` +
      tail.slice(tailCut > 0 ? tailCut : 0);
  }

  return { result, skipped, totalLines: lines.length };
}

// ─── 入口 ────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || !opts.file) {
    console.log(`用法: node ${path.basename(process.argv[1])} <jsonl文件> [选项]

从 Claude Code JSONL 会话文件中提取对话核心内容。
默认只输出用户与 AI 的纯文本对话，跳过思考块、工具调用、系统消息。

选项:
  --thinking        包含思考块
  --tools           包含工具调用（tool_use / tool_result）
  --all             包含全部内容（thinking + tools）
  --max-chars N     截断输出到 N 字符（默认 100000，0=不截断）
  --no-role-prefix  不输出「用户：/AI：」前缀
  -o, --output 文件 写入文件而非 stdout
  -h, --help        显示本帮助

示例:
  node scripts/extract-session.js ~/.claude/projects/-Foo-Bar/abc.jsonl
  node scripts/extract-session.js abc.jsonl --thinking --tools
  node scripts/extract-session.js abc.jsonl -o out.txt --max-chars 50000`);
    process.exit(opts.help ? 0 : 2);
  }

  if (!fs.existsSync(opts.file)) {
    console.error(`文件不存在: ${opts.file}`);
    process.exit(1);
  }

  try {
    const { result, skipped, totalLines } = processFile(opts.file, opts);

    if (opts.output) {
      fs.writeFileSync(opts.output, result, "utf-8");
      console.error(
        `已写入 ${opts.output}（${totalLines} 行 → ${result.length} 字符，跳过噪音 ${skipped} 行）`
      );
    } else {
      process.stdout.write(result + "\n");
      console.error(
        `\n[统计] 原始 ${totalLines} 行 | 输出 ${result.length} 字符 | 跳过 ${skipped} 行`,
      );
    }
  } catch (e) {
    console.error(`处理失败: ${e.message}`);
    process.exit(1);
  }
}

main();
