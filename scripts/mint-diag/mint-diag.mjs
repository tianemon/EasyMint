#!/usr/bin/env node
// mint-diag — Mint 会话四指标诊断（零验证修改轮 / 轮次形态 / 探索-动手比 / 纠偏率）。
// 口径与 2026-08 行为实证分析一致，用于提示词改动前后的同项目对比（实施计划第七节）。
//
// 用法: node scripts/mint-diag/mint-diag.mjs <session.jsonl> [pi|wb|cc]
//   pi = EasyMint(Pi SDK) 会话（默认）；wb = WorkBuddy；cc = Claude Code
import { NORMALIZERS, segment, catOf } from "./norm.mjs";

const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// 用户纠偏信号（严格集合，来自之前验证过的口径）
const CORRECT = [
  /你改的是哪个/, /我说的是/, /不是这个/, /不对[,，。!！]/, /理解错了/,
  /还是(不|没|未)/, /没(变化|解决|生效|反应)/, /又(坏|出现|变)/,
  /怎么还是/, /跟之前一样/, /没用[,，。]/, /白改/, /回退|回滚|撤销/,
];

function turnStats(t) {
  const evts = t.evts;
  const calls = evts.filter((e) => e.kind === "tool_call");
  const think = evts.filter((e) => e.kind === "thinking");
  const seq = calls.map(catOf);
  const firstM = seq.findIndex((c) => c === "M");
  const lastTs = evts.length ? Math.max(...evts.map((e) => e.ts).filter(Boolean)) : t.ts;
  return {
    text: (t.text || "").replace(/\s+/g, " "),
    calls: calls.length,
    thinkChars: think.reduce((a, e) => a + e.chars, 0),
    E: seq.filter((c) => c === "E").length,
    M: seq.filter((c) => c === "M").length,
    V: seq.filter((c) => c === "V").length,
    O: seq.filter((c) => c === "O").length,
    firstM: firstM < 0 ? null : firstM / seq.length,
    seq: seq.join(""),
    mins: lastTs > t.ts ? (lastTs - t.ts) / 60000 : 0,
  };
}

const [file, fmt = "pi"] = process.argv.slice(2);
if (!file || !NORMALIZERS[fmt]) {
  console.error("用法: node scripts/mint-diag/mint-diag.mjs <session.jsonl> [pi|wb|cc]");
  process.exit(1);
}

const events = NORMALIZERS[fmt](file);
const rawTurns = segment(events).map(turnStats);

// 标记用户纠偏轮：本轮之后的下一条用户消息含纠偏信号
const userMsgs = events.filter((e) => e.kind === "user_text");
const realUser = userMsgs.map((e) => (e.text || "").replace(/\s+/g, " ")).filter((t) => t && !/^(please continue|continue from|继续)/i.test(t));
const correctedSet = new Set(realUser.filter((t) => CORRECT.some((r) => r.test(t))).map((t) => t.slice(0, 50)));
console.log("用户纠偏消息数（严格口径）:", correctedSet.size, "/", realUser.length);
for (const c of correctedSet) console.log("  ·", c.slice(0, 80));

console.log("\n===== 轮次形态分布 =====");
const groups = {
  "纯探索零修改(E≥3, M=0)": (t) => t.E >= 3 && t.M === 0,
  "改了没验证(M≥1, V=0)": (t) => t.M >= 1 && t.V === 0,
  "改-验齐备(M≥1, V≥1)": (t) => t.M >= 1 && t.V >= 1,
  "纯对话零调用": (t) => t.calls === 0,
  "其他": (t) => false,
};
for (const [label, test] of Object.entries(groups)) {
  const g = rawTurns.filter((t) => t.calls > 0).filter(test);
  const all = rawTurns.filter((t) => t.calls > 0);
  if (!g.length) continue;
  console.log(`${label}: ${g.length} 轮 (${(g.length / all.length * 100).toFixed(0)}%)  提问中位${med(g.map((t) => t.text.length))}字符  耗时中位${med(g.map((t) => t.mins)).toFixed(1)}分`);
}

console.log("\n===== 探索重、动手轻的诊断 =====");
const heavy = rawTurns.filter((t) => t.calls >= 8).sort((a, b) => b.calls - a.calls);
console.log("高调用轮(≥8次):", heavy.length, "轮");
for (const t of heavy.slice(0, 12)) {
  console.log(`  ${String(t.calls).padStart(3)}调用 E${t.E} M${t.M} V${t.V} ${t.mins.toFixed(1).padStart(5)}分 | ${t.text.slice(0, 65)}`);
}

console.log("\n===== 验证后仍返工的主题（看连续轮的提问相似度） =====");
// 简单办法：列出含纠偏信号的轮次及其前一轮
for (let i = 1; i < rawTurns.length; i++) {
  if (CORRECT.some((r) => r.test(rawTurns[i].text))) {
    console.log(`  [返工] 前轮(${rawTurns[i-1].calls}调用,M${rawTurns[i-1].M},V${rawTurns[i-1].V}): ${rawTurns[i-1].text.slice(0, 55)}`);
    console.log(`         纠偏: ${rawTurns[i].text.slice(0, 75)}`);
  }
}

console.log("\n===== 思考与动作比 =====");
const perCall = rawTurns.filter((t) => t.calls > 0).map((t) => t.thinkChars / t.calls);
console.log("思考字符/调用 中位:", Math.round(med(perCall)));
const withThink = rawTurns.filter((t) => t.calls > 0 && t.thinkChars > 0).length;
console.log("有思考的轮:", withThink, "/", rawTurns.filter((t) => t.calls > 0).length);
