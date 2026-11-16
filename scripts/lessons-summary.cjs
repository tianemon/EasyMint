#!/usr/bin/env node
/** 打印本机经验判定统计：采纳数、拒绝原因分布。用于判断门槛是否过严。 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const file = path.join(process.env.EASY_MINT_HOME || path.join(os.homedir(), ".easymint"), "experiences", "decisions.jsonl");
if (!fs.existsSync(file)) {
  console.log("尚无判定记录（后台还没产出过经验候选）：", file);
  process.exit(0);
}
const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const saved = rows.filter((row) => row.saved).length;
const reasons = {};
for (const row of rows) if (!row.saved && row.reason) reasons[row.reason] = (reasons[row.reason] || 0) + 1;
console.log(`判定 ${rows.length} 条：采纳 ${saved} 条，拒绝 ${rows.length - saved} 条`);
for (const [reason, count] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${count}× ${reason}`);
