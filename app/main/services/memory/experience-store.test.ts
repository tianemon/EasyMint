import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { readIndex, saveLesson } from "./experience-store";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function dir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-lesson-"));
  dirs.push(root);
  return path.join(root, "experiences");
}

const lesson = {
  title: "本机 pnpm 装依赖被代理拖慢",
  when: "当本机 pnpm install 超过两分钟没有下载进度时",
  do: "先 env -u NODE_OPTIONS 并关闭系统代理再重试",
  why: "本机变量与代理会放大安装耗时",
  tags: ["pnpm", "本机"],
};

it("写入一条经验：正文按标题命名，索引同步更新", () => {
  const d = dir();
  expect(saveLesson(d, lesson, "实测 400 倍耗时").saved).toBe(true);
  const index = readIndex(d);
  expect(index.items).toHaveLength(1);
  expect(index.items[0]!.title).toBe(lesson.title);
  const body = fs.readFileSync(path.join(d, index.items[0]!.file), "utf8");
  expect(body).toContain("【本机 pnpm 装依赖被代理拖慢】");
  expect(body).toContain("为什么：");
  expect(body).toContain("实测 400 倍耗时");
});

it("不合格的候选不落盘，也不写索引", () => {
  const d = dir();
  const bad = saveLesson(d, { title: "要小心", when: "当遇到问题时", do: "注意一点" }, "");
  expect(bad.saved).toBe(false);
  expect(readIndex(d).items).toHaveLength(0);
  expect(fs.existsSync(path.join(d, "index.json"))).toBe(false);
});

it("重复标题被拒，不会产生第二条", () => {
  const d = dir();
  saveLesson(d, lesson, "");
  expect(saveLesson(d, lesson, "").saved).toBe(false);
  expect(readIndex(d).items).toHaveLength(1);
});

it("索引损坏时不覆盖旧正文，只按空索引重来", () => {
  const d = dir();
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "index.json"), "{broken");
  expect(saveLesson(d, lesson, "").saved).toBe(true);
  expect(readIndex(d).items).toHaveLength(1);
});
