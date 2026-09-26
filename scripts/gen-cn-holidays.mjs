#!/usr/bin/env node
/**
 * 生成中国法定节假日日期表 → app/main/services/cn-holidays.generated.ts
 *
 * 用途：DeepSeek 的分时段计价里「法定节假日全天空闲」，判定需要「这天是不是法定节假日」。
 * 为什么用外部数据而不是算农历：法定节假日的**实际放假日与调休是国务院每年公告定的**
 * （例如春节从除夕还是初一开始、连休几天），农历只能推出节日当天，推不出放假区间。
 * 数据源 NateScarlet/holiday-cn（MIT）自动抓取国务院公告，每年公告发布后自动更新。
 *
 * 只取 `isOffDay: true` 的日期（法定节假日当天）。「与周末连休」的周末不在数据里，
 * 也不需要——周末本来就是空闲时段。
 *
 * 用法：node scripts/gen-cn-holidays.mjs [起始年] [结束年]
 *   默认 2007 到「当前年份 + 1」；未公告的年份上游会 404，自动跳过。
 *   **新一年度公告发布后重跑并提交生成物**（这就是这张表的维护方式）。
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FROM = Number(process.argv[2]) || 2007;
const TO = Number(process.argv[3]) || new Date().getUTCFullYear() + 1;
const BASE = "https://raw.githubusercontent.com/NateScarlet/holiday-cn/master";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "main", "services", "cn-holidays.generated.ts");

/** @type {Map<string, string[]>} 年份 → 该年的法定节假日日期（ISO） */
const byYear = new Map();
const papers = new Set();
const failures = [];

for (let year = FROM; year <= TO; year++) {
  const url = `${BASE}/${year}.json`;
  let payload;
  try {
    const resp = await fetch(url);
    if (resp.status === 404) continue; // 尚未公告的年份
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    payload = await resp.json();
  } catch (error) {
    // 部分年份拉不下来时**不写文件**：残缺的表比没有表更危险（会静默少掉那几年的节假日）
    failures.push(`${year}（${error instanceof Error ? error.message : String(error)}）`);
    continue;
  }
  for (const paper of payload.papers ?? []) papers.add(paper);
  for (const day of payload.days ?? []) {
    if (!day.isOffDay) continue; // 调休上班日：DeepSeek 口径按「周一至周五」判定，周末本就是空闲
    // 按日期本身的年份归档：国务院文件标题年份与日期年份可能不一致（12 月的日期可能被次年的文件决定）
    const dateYear = String(day.date).slice(0, 4);
    const list = byYear.get(dateYear) ?? [];
    if (!list.includes(day.date)) list.push(day.date);
    byYear.set(dateYear, list);
  }
}

const years = [...byYear.keys()].sort();
const total = years.reduce((sum, y) => sum + byYear.get(y).length, 0);
if (failures.length > 0) {
  console.error(`[cn-holidays] 失败年份：${failures.join("、")}——为了不写出残缺的表，本次不生成文件`);
  process.exit(1);
}
if (total === 0) {
  console.error("[cn-holidays] 没抓到任何数据，不覆盖生成物");
  process.exit(1);
}

const body = years
  .map((year) => `  ${year}: [${byYear.get(year).sort().map((d) => `"${d}"`).join(", ")}],`)
  .join("\n");
const paperList = [...papers].sort().map((p) => ` *   ${p}`).join("\n");

const content = `/**
 * 中国法定节假日日期表（DeepSeek 分时段计价用：法定节假日全天空闲）。
 *
 * **本文件由 scripts/gen-cn-holidays.mjs 生成，不要手改。**
 * 数据源：NateScarlet/holiday-cn（MIT，自动抓取国务院公告）——只含 \`isOffDay: true\` 的法定节假日当天。
 * 抓取时间：${new Date().toISOString().slice(0, 10)}
 * 覆盖年份：${years[0]}–${years.at(-1)}（共 ${years.length} 年 / ${total} 天；上游尚未公告的年份在上表中不存在）
 *
 * 涉及文件：
${paperList}
 *
 * 维护：新一年度放假安排公告发布后重跑 \`node scripts/gen-cn-holidays.mjs\` 并提交生成物；
 * 表里查不到的年份按「工作日 + 周末」近似（少了节假日当天的空闲判定，偏高但不偏低）。
 */

export const CN_HOLIDAYS: Readonly<Record<string, readonly string[]>> = {
${body}
};

/** 生成时抓到的年份范围（用于界面/日志说明覆盖到哪一年） */
export const CN_HOLIDAYS_COVERAGE = { from: "${years[0]}", to: "${years.at(-1)}" } as const;
`;

writeFileSync(OUT, content);
console.log(`[cn-holidays] 已写入 ${path.relative(process.cwd(), OUT)}：${years.length} 年 / ${total} 天（${years[0]}–${years.at(-1)}）`);
