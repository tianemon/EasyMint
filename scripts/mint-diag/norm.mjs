// 会话事件归一化（CC / WB / Pi 三种 JSONL → 统一事件流）+ 轮次切分 + 调用分类。
// 供 mint-diag.mjs 等度量脚本复用；口径与 2026-08 行为实证分析一致。
import fs from "fs";

export const ts = (v) => (typeof v === "string" ? Date.parse(v) : v) || 0;

export function normalizeCC(file) {
  const events = [];
  const nameById = new Map();
  for (const line of fs.readFileSync(file, "utf-8").split("\n").filter((l) => l.trim())) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (!o || o.isMeta) continue;
    const t = ts(o.timestamp);
    const c = o.message && o.message.content;
    if (o.type === "assistant" && Array.isArray(c)) {
      for (const b of c) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "thinking") events.push({ kind: "thinking", ts: t, chars: (b.thinking || "").trim().length, text: b.thinking });
        else if (b.type === "text") events.push({ kind: "assistant_text", ts: t, chars: (b.text || "").trim().length, text: b.text });
        else if (b.type === "tool_use") { nameById.set(b.id, b.name); events.push({ kind: "tool_call", ts: t, id: b.id, name: b.name, argsChars: JSON.stringify(b.input || {}).length, input: b.input || {} }); }
      }
      continue;
    }
    if (o.type === "user") {
      if (Array.isArray(c)) {
        for (const b of c) {
          if (!b || typeof b !== "object") continue;
          if (b.type === "tool_result") {
            const cc2 = b.content;
            const txt = typeof cc2 === "string" ? cc2 : Array.isArray(cc2) ? cc2.filter((x) => x && x.type === "text").map((x) => x.text).join("\n") : "";
            events.push({ kind: "tool_result", ts: t, id: b.tool_use_id, name: nameById.get(b.tool_use_id) || "?", chars: txt.length, isError: !!b.is_error, text: txt });
          } else if (b.type === "text") events.push({ kind: "user_text", ts: t, chars: (b.text || "").trim().length, text: b.text });
        }
      } else if (typeof c === "string") events.push({ kind: "user_text", ts: t, chars: c.trim().length, text: c });
    }
  }
  return events.sort((a, b) => a.ts - b.ts);
}

export function normalizeWB(file) {
  const events = [];
  for (const line of fs.readFileSync(file, "utf-8").split("\n").filter((l) => l.trim())) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (!e || typeof e !== "object") continue;
    const t = ts(e.timestamp);
    if (e.type === "message" && e.role === "user") {
      const txt = Array.isArray(e.content) ? e.content.map((b) => (b && b.text) || "").join("") : "";
      events.push({ kind: "user_text", ts: t, chars: txt.length, text: txt });
    } else if (e.type === "message" && e.role === "assistant") {
      const txt = Array.isArray(e.content) ? e.content.map((b) => (b && b.text) || "").join("") : "";
      events.push({ kind: "assistant_text", ts: t, chars: txt.trim().length, text: txt, failed: e.status === "incomplete" });
    } else if (e.type === "reasoning") {
      const txt = Array.isArray(e.rawContent) ? e.rawContent.map((b) => (b && b.text) || "").join("") : Array.isArray(e.content) ? e.content.map((b) => (b && b.text) || "").join("") : "";
      events.push({ kind: "thinking", ts: t, chars: txt.trim().length, text: txt });
    } else if (e.type === "function_call") {
      let input = {}; try { input = JSON.parse(e.arguments || "{}"); } catch { /* ignore */ }
      events.push({ kind: "tool_call", ts: t, id: e.callId, name: e.name, argsChars: (e.arguments || "").length, input });
    } else if (e.type === "function_call_result") {
      const txt = (e.output && e.output.text) || "";
      events.push({ kind: "tool_result", ts: t, id: e.callId, name: e.name, chars: txt.length, isError: e.status !== "completed", text: txt });
    }
  }
  return events.sort((a, b) => a.ts - b.ts);
}

export function normalizePi(file) {
  const events = [];
  for (const line of fs.readFileSync(file, "utf-8").split("\n").filter((l) => l.trim())) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    const t = ts(o.timestamp);
    if (o.type === "custom_message") { events.push({ kind: "system_note", ts: t, chars: (o.content || "").length }); continue; }
    if (o.type !== "message") continue;
    const m = o.message || {};
    const blocks = Array.isArray(m.content) ? m.content : [];
    if (m.role === "user") {
      const txt = blocks.map((b) => (typeof b === "string" ? b : b.text || "")).join("");
      events.push({ kind: "user_text", ts: t, chars: txt.trim().length, text: txt });
    } else if (m.role === "assistant") {
      for (const b of blocks) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "thinking") events.push({ kind: "thinking", ts: t, chars: (b.thinking || "").trim().length, text: b.thinking });
        else if (b.type === "text") events.push({ kind: "assistant_text", ts: t, chars: (b.text || "").trim().length, text: b.text });
        else if (b.type === "toolCall") events.push({ kind: "tool_call", ts: t, id: b.id, name: b.name, argsChars: JSON.stringify(b.arguments || {}).length, input: b.arguments || {} });
      }
    } else if (m.role === "toolResult") {
      const txt = blocks.map((b) => (typeof b === "string" ? b : b.text || "")).join("");
      events.push({ kind: "tool_result", ts: t, id: m.toolCallId, name: m.toolName, chars: txt.length, isError: !!m.isError, text: txt });
    }
  }
  return events.sort((a, b) => a.ts - b.ts);
}

const INJECTED = ["system-reminder", "cb_summary", "conversation_history_summary", "task-notification", "command-name", "command-message", "command-args", "local-command-stdout", "system_context", "available_deferred_tools"];
export function stripInjected(text) {
  let out = text || "";
  for (const tag of INJECTED) {
    const open = `<${tag}\\b[^>]*>`;
    out = out.replace(new RegExp(`${open}[\\s\\S]*?</${tag}\\s*>`, "g"), "").replace(new RegExp(`${open}[\\s\\S]*$`, "g"), "");
  }
  return out.replace(/<\/?(user_query|antml:user_query)\s*>/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
export const BOILERPLATE = /^(please continue|continue from|this session is being continued|CRITICAL: Read|You are an AI|# Claude Code|As you answer|继续|继续做|接着做|接着|继续吧|嗯继续|ok继续|go on|continue)/i;
export function isRealTurn(raw) {
  const t = stripInjected(raw);
  if (!t) return { real: false, clean: t };
  if (BOILERPLATE.test(t.replace(/^[\s，。,.!！]+/, ""))) return { real: false, clean: t };
  return { real: true, clean: t };
}

export function segment(events) {
  const turns = [];
  let cur = null;
  for (const e of events) {
    if (e.kind === "user_text") {
      const { real, clean } = isRealTurn(e.text || "");
      if (real) { if (cur) turns.push(cur); cur = { text: clean, ts: e.ts, evts: [], subs: 1 }; }
      else if (cur) { cur.subs++; cur.evts.push(e); }
      continue;
    }
    if (cur) cur.evts.push(e);
  }
  if (cur) turns.push(cur);
  return turns;
}

const VERIFY_RE = /(flutter analyze|flutter test|flutter build|npx tsc|npx eslint|npx vitest|npm run (test|lint|build|typecheck|analyze)|npm test|dart analyze|dart format --output|yarn test|pnpm (test|build)|go test|cargo test|pytest|tsc --noEmit|electron-builder)/i;
const EXPLORE_RE = /(^|[;&|]\s*|\s)(git (status|diff|log|show|branch|blame)|\bls\b|\bfind\b|\bcat\b|\bhead\b|\btail\b|\bgrep\b|\brg\b|\btree\b|\bwc\b|\bpwd\b|\bwhich\b|\becho\b|\bsed -n\b|\bawk\b|\bfile\b|\bstat\b)/i;
export function classifyBash(cmd) {
  const c = cmd || "";
  if (!c.trim()) return "O";
  if (VERIFY_RE.test(c)) return "V";
  if (EXPLORE_RE.test(c)) return "E";
  return "M";
}
export function catOf(e) {
  const n = (e.name || "").toLowerCase();
  if (n === "edit" || n === "write" || n === "multiedit" || n === "notebookedit") return "M";
  if (n === "read" || n === "grep" || n === "glob" || n === "websearch" || n === "webfetch" || n === "web_fetch") return "E";
  if (n === "bash") return classifyBash(e.input && e.input.command);
  if (/^mcp__(playwright|codegraph|image-vision|tavily)/.test(n)) return "E";
  return "O";
}

export const NORMALIZERS = { cc: normalizeCC, wb: normalizeWB, pi: normalizePi };
