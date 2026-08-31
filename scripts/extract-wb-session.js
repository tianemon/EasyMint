#!/usr/bin/env node
/**
 * extract-wb-session.js — 从 WorkBuddy 会话 JSONL 中提取对话核心内容
 *
 * WorkBuddy 会话落盘位置：~/.workbuddy/projects/<编码路径>/<sessionId>.jsonl
 *
 * 【格式说明】每行是一个扁平 entry（无 message 包装层）：
 *   {type, id, parentId|logicalParentId, timestamp, cwd, sessionId, providerData, ...}
 *
 *   type = "message"          role: "user" | "assistant"
 *                             content: [{type:"input_text"|"output_text", text}]
 *                             status: "completed" | "incomplete"（incomplete 时 providerData.error 有详情）
 *   type = "reasoning"        content: [] + rawContent: [{type:"reasoning_text", text}]
 *   type = "function_call"    name, callId, arguments（JSON 字符串）
 *   type = "function_call_result"  name, callId, status, output:{type:"text", text}
 *   type = "file-history-snapshot"   纯噪音（文件备份快照，占总量约 15%）
 *   type = "ai-title"         aiTitle
 *   type = "resend-fork-notice"      用户编辑历史消息后重发产生的分叉标记
 *
 * 两个易踩的坑：
 *   1. entry.id 不是全局唯一 —— function_call 的 id 是模型的 messageId，
 *      同一次响应里的多个工具调用会共享同一个 id。真正的调用唯一键是 callId。
 *   2. 用户消息里混有运行时注入的大块上下文（<system-reminder> 8760 字符、
 *      <cb_summary> 93K 字符等），默认已剥离，否则真实对话会被淹没。
 *
 * 用法：
 *   node scripts/extract-wb-session.js <jsonl文件> [选项]
 *
 * 选项：
 *   --thinking         包含思考过程（reasoning）
 *   --tools            包含工具调用与结果（function_call / function_call_result）
 *   --meta             包含会话元信息（标题 / 分叉重发标记）
 *   --all              以上全部
 *   --keep-context     保留被注入的上下文块（默认剥离）
 *   --tool-max-chars N 单条工具入参/输出截断到 N 字符（默认 2000，0=不截断）
 *   --max-chars N      整体输出截断到 N 字符（默认不截断）
 *   --no-truncate      取消截断
 *   --no-role-prefix   不输出「用户：/AI：」前缀
 *   --no-dedup         关闭按语义键去重（entry.id 会跨条目复用，默认开启去重）
 *   --stats            输出详细统计（默认只输出一行摘要）
 *   -o, --output 文件  写入文件而非 stdout
 *   -h, --help         显示帮助
 *
 * 示例：
 *   node scripts/extract-wb-session.js ~/.workbuddy/projects/-Users-x-proj/abc.jsonl
 *   node scripts/extract-wb-session.js abc.jsonl --thinking --tools
 *   node scripts/extract-wb-session.js abc.jsonl --all -o out.txt --max-chars 50000
 */

import fs from "fs";
import path from "path";

// ─── 常量 ────────────────────────────────────────────────

/** 运行时注入到用户消息里的上下文块标签（默认剥离） */
const INJECTED_TAGS = [
  "system-reminder",
  "cb_summary",
  "conversation_history_summary",
  "task-notification",
  "command-name",
  "command-message",
  "command-args",
  "local-command-stdout",
];

/** 跳过的纯噪音类型（只计数，不输出） */
const NOISE_TYPES = new Set(["file-history-snapshot"]);

// ─── 参数解析 ────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    file: null,
    thinking: false,
    tools: false,
    meta: false,
    keepContext: false,
    toolMaxChars: 2000,
    maxChars: 0,
    truncate: false, // 默认全量输出，显式 --max-chars 才截断
    rolePrefix: true,
    dedup: true,
    stats: false,
    output: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--thinking": opts.thinking = true; break;
      case "--tools": opts.tools = true; break;
      case "--meta": opts.meta = true; break;
      case "--all":
        opts.thinking = true; opts.tools = true; opts.meta = true; break;
      case "--keep-context": opts.keepContext = true; break;
      case "--tool-max-chars":
        opts.toolMaxChars = parseInt(argv[++i], 10);
        if (isNaN(opts.toolMaxChars) || opts.toolMaxChars < 0) opts.toolMaxChars = 2000;
        break;
      case "--max-chars":
        opts.maxChars = parseInt(argv[++i], 10);
        if (isNaN(opts.maxChars) || opts.maxChars <= 0) opts.maxChars = 0;
        opts.truncate = opts.maxChars > 0;
        break;
      case "--no-truncate": opts.truncate = false; break;
      case "--no-role-prefix": opts.rolePrefix = false; break;
      case "--role-prefix": opts.rolePrefix = true; break;
      case "--no-dedup": opts.dedup = false; break;
      case "--dedup": opts.dedup = true; break;
      case "--stats": opts.stats = true; break;
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

/**
 * 从 content 数组里取出全部文本。
 * 兼容 WorkBuddy 的 input_text / output_text，以及 Claude 风格的 text
 * 和 Pi 风格把文本放在 content 字段里的写法。
 */
function blocksText(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  const parts = [];
  for (const block of content) {
    if (!block) continue;
    if (typeof block === "string") { parts.push(block); continue; }
    if (typeof block !== "object") continue;

    const raw =
      typeof block.text === "string" ? block.text
        : typeof block.content === "string" ? block.content
          : typeof block.thinking === "string" ? block.thinking
            : "";
    if (raw.trim()) parts.push(raw.trim());
  }
  return parts.join("\n\n");
}

/** 取 reasoning 文本：优先 rawContent.reasoning_text，回退 content / providerData.reasoning */
function reasoningText(entry) {
  const fromRaw = blocksText(entry.rawContent);
  if (fromRaw) return fromRaw;

  const fromContent = blocksText(entry.content);
  if (fromContent) return fromContent;

  const fallback = entry.providerData && entry.providerData.reasoning;
  return typeof fallback === "string" ? fallback.trim() : "";
}

/** 取工具结果文本：output.text → providerData.toolResult.content */
function toolResultText(entry) {
  const out = entry.output;
  if (out) {
    const t = typeof out === "string" ? out : blocksText(out.text ?? out.content);
    if (t.trim()) return t.trim();
  }
  const tr = entry.providerData && entry.providerData.toolResult;
  if (tr) {
    const t = typeof tr.content === "string" ? tr.content : blocksText(tr.content);
    if (t.trim()) return t.trim();
  }
  return "";
}

/** 按字符上限截断，超出部分用省略标记替换 */
function clip(text, maxChars) {
  if (!maxChars || text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n…[省略 ${text.length - maxChars} 字符]…\n${text.slice(text.length - tail)}`;
}

/**
 * 清理用户消息：剥离运行时注入的上下文块，并去掉 <user_query> 包裹标签。
 * <user_query> 是宿主套在真实提问外的包装层，不是用户写的内容，
 * 所以只去标签、保留正文。
 */
function stripInjected(text) {
  let out = text;
  for (const tag of INJECTED_TAGS) {
    const open = `<${tag}\\b[^>]*>`;
    out = out.replace(new RegExp(`${open}[\\s\\S]*?</${tag}\\s*>`, "g"), ""); // 成对块
    out = out.replace(new RegExp(`${open}[\\s\\S]*$`, "g"), "");             // 未闭合块
  }
  out = out.replace(/<\/?user_query\s*>/g, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

// ─── 去重 ────────────────────────────────────────────────

/**
 * 语义去重键。
 * entry.id 会跨条目复用（function_call 用的是模型 messageId），
 * 所以工具调用必须用 callId；消息类用 (type, id) 就足够。
 * 返回 null 表示该条目不参与合并。
 */
function dedupKey(entry) {
  switch (entry.type) {
    case "function_call": return `fc:${entry.callId || entry.id}`;
    case "function_call_result": return `fr:${entry.callId || entry.id}`;
    case "message": return `msg:${entry.id}`;
    case "reasoning": return `re:${entry.id}`;
    default: return null;
  }
}

/** 按语义键合并重复写入，保留最后一次的内容、第一次出现的位置 */
function dedupe(entries) {
  const slots = [];
  const slotOf = new Map();
  const latest = new Map();

  entries.forEach((entry, i) => {
    const key = dedupKey(entry);
    if (!key) {
      slots.push({ sortIdx: i, key: null, entry });
      return;
    }
    if (!slotOf.has(key)) {
      slotOf.set(key, slots.length);
      slots.push({ sortIdx: i, key, entry: null });
    }
    latest.set(key, entry);
  });

  return slots.map((s) => (s.key === null ? s.entry : latest.get(s.key)));
}

// ─── 主处理 ──────────────────────────────────────────────

function processFile(filePath, opts) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);

  const parsed = [];
  let badLines = 0;
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry === "object") parsed.push(entry);
    } catch {
      badLines++;
    }
  }

  const entries = opts.dedup ? dedupe(parsed) : parsed;

  const out = [];
  const stat = {
    totalLines: lines.length,
    parsedLines: parsed.length,
    afterDedup: entries.length,
    badLines,
    strippedChars: 0,
    typeCount: {},
    toolCount: {},
    title: null,
    cwd: null,
    sessionId: null,
    timeFrom: null,
    timeTo: null,
  };

  for (const entry of entries) {
    const type = entry.type;
    stat.typeCount[type] = (stat.typeCount[type] || 0) + 1;
    if (entry.cwd) stat.cwd = entry.cwd;
    if (entry.sessionId) stat.sessionId = entry.sessionId;
    if (typeof entry.timestamp === "number") {
      if (stat.timeFrom === null || entry.timestamp < stat.timeFrom) stat.timeFrom = entry.timestamp;
      if (stat.timeTo === null || entry.timestamp > stat.timeTo) stat.timeTo = entry.timestamp;
    }

    if (NOISE_TYPES.has(type)) continue;

    if (type === "message") {
      let text = blocksText(entry.content);
      if (entry.role === "user" && !opts.keepContext) {
        const stripped = stripInjected(text);
        stat.strippedChars += text.length - stripped.length;
        text = stripped;
      }
      if (!text) continue;

      if (entry.role === "user") {
        out.push(opts.rolePrefix ? `用户：${text}` : text);
      } else if (entry.role === "assistant") {
        // status 为 incomplete 说明该轮请求失败，正文通常是错误提示，标注出来避免误读
        const failed = entry.status === "incomplete";
        const err = failed && entry.providerData && entry.providerData.error;
        const label = failed ? `AI（出错${err && err.status ? ` ${err.status}` : ""}）：` : "AI：";
        out.push(opts.rolePrefix ? `${label}${text}` : text);
      }
      continue;
    }

    if (type === "reasoning" && opts.thinking) {
      const text = reasoningText(entry);
      if (text) out.push(`[思考过程]\n${clip(text, opts.toolMaxChars)}`);
      continue;
    }

    if (type === "function_call" && opts.tools) {
      stat.toolCount[entry.name] = (stat.toolCount[entry.name] || 0) + 1;
      const args = typeof entry.arguments === "string" ? entry.arguments : JSON.stringify(entry.arguments ?? {});
      out.push(`[工具调用: ${entry.name}]\n${clip(args, opts.toolMaxChars)}`);
      continue;
    }

    if (type === "function_call_result" && opts.tools) {
      const text = toolResultText(entry);
      const bad = entry.status && entry.status !== "completed";
      const label = `[工具结果${bad ? ` (${entry.status})` : ""}${entry.name ? `: ${entry.name}` : ""}]`;
      if (text) out.push(`${label}\n${clip(text, opts.toolMaxChars)}`);
      continue;
    }

    if (type === "ai-title") {
      stat.title = entry.aiTitle || null;
      if (opts.meta && entry.aiTitle) out.push(`[会话标题] ${entry.aiTitle}`);
      continue;
    }

    if (type === "resend-fork-notice" && opts.meta) {
      out.push(`[分叉重发] 用户编辑并重新发送了消息 ${entry.editedUserItemId || "(未知 id)"}`);
      continue;
    }
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

  return { result, stat };
}

// ─── 输出 ────────────────────────────────────────────────

function formatStats(stat, resultLength, verbose) {
  const lines = [];
  const kb = (n) => `${(n / 1024).toFixed(1)}K`;
  lines.push(
    `[统计] 原始 ${stat.totalLines} 行 → 去重后 ${stat.afterDedup} 条 → 输出 ${kb(resultLength)} 字符` +
    `${stat.badLines ? ` | 解析失败 ${stat.badLines} 行` : ""}` +
    `${stat.strippedChars ? ` | 剥离注入上下文 ${kb(stat.strippedChars)} 字符` : ""}`
  );
  if (!verbose) return lines.join("\n");

  lines.push(`  会话: ${stat.title || "(无标题)"}`);
  lines.push(`  sessionId: ${stat.sessionId || "-"}`);
  lines.push(`  工作目录: ${stat.cwd || "-"}`);
  if (stat.timeFrom && stat.timeTo) {
    lines.push(`  时间: ${new Date(stat.timeFrom).toLocaleString("zh-CN")} ~ ${new Date(stat.timeTo).toLocaleString("zh-CN")}`);
  }
  lines.push("  条目类型分布:");
  for (const [t, c] of Object.entries(stat.typeCount).sort((a, b) => b[1] - a[1])) {
    lines.push(`    ${String(c).padStart(5)}  ${t}${NOISE_TYPES.has(t) ? "（已跳过）" : ""}`);
  }
  const tools = Object.entries(stat.toolCount).sort((a, b) => b[1] - a[1]);
  if (tools.length) {
    lines.push("  工具调用频次: " + tools.map(([n, c]) => `${n}×${c}`).join("  "));
  }
  return lines.join("\n");
}

// ─── 入口 ────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || !opts.file) {
    console.log(`用法: node ${path.basename(process.argv[1])} <workbuddy会话jsonl文件> [选项]

从 WorkBuddy 会话 JSONL 中提取对话核心内容。
默认只输出用户与 AI 的纯文本对话，跳过思考过程、工具调用、文件快照等噪音。

选项:
  --thinking         包含思考过程（reasoning）
  --tools            包含工具调用与结果（function_call / function_call_result）
  --meta             包含会话元信息（标题 / 分叉重发标记）
  --all              以上全部
  --keep-context     保留运行时注入的上下文块（默认剥离）
  --tool-max-chars N 单条工具入参/输出截断到 N 字符（默认 2000，0=不截断）
  --max-chars N      整体输出截断到 N 字符（默认不截断）
  --no-truncate      取消截断
  --no-role-prefix   不输出「用户：/AI：」前缀
  --no-dedup         关闭按语义键去重（entry.id 会跨条目复用，默认开启）
  --stats            输出详细统计
  -o, --output 文件  写入文件而非 stdout
  -h, --help         显示帮助

会话文件位置: ~/.workbuddy/projects/<编码路径>/<sessionId>.jsonl

示例:
  node scripts/extract-wb-session.js ~/.workbuddy/projects/-Users-x-proj/abc.jsonl
  node scripts/extract-wb-session.js abc.jsonl --thinking --tools --stats
  node scripts/extract-wb-session.js abc.jsonl --all -o out.txt --max-chars 50000`);
    process.exit(opts.help ? 0 : 2);
  }

  if (!fs.existsSync(opts.file)) {
    console.error(`文件不存在: ${opts.file}`);
    process.exit(1);
  }

  try {
    const { result, stat } = processFile(opts.file, opts);

    if (opts.output) {
      fs.writeFileSync(opts.output, result, "utf-8");
      console.error(`已写入 ${opts.output}`);
    } else {
      process.stdout.write(result + "\n");
    }
    console.error("\n" + formatStats(stat, result.length, opts.stats));
  } catch (e) {
    console.error(`处理失败: ${e.message}`);
    process.exit(1);
  }
}

main();
