import { expect, it } from "vitest";
import { guardLesson } from "./lesson-guard";

const good = {
  title: "本机 pnpm 装依赖被系统代理拖慢",
  when: "当在本机执行 pnpm install 超过两分钟且无下载进度时",
  do: "先执行 env -u NODE_OPTIONS 并关闭代理再重试，仍慢再换 npm",
  why: "本机 Node 环境变量与代理会放大安装耗时约 400 倍",
};

it("具体的触发条件 + 可执行做法才通过", () => {
  expect(guardLesson(good)).toEqual({ ok: true });
});

it("泛泛而谈被拒：没有具体对象", () => {
  expect(guardLesson({ title: "要更小心", when: "当遇到问题时", do: "注意一点并仔细检查" }).ok).toBe(false);
});

it("缺少触发条件或做法分别被拒", () => {
  expect(guardLesson({ ...good, when: "" }).ok).toBe(false);
  expect(guardLesson({ title: good.title, when: good.when, do: "" }).ok).toBe(false);
  expect(guardLesson({ ...good, when: "有时候会报错" }).ok).toBe(false);
});

it("过长或过短都不算一条经验", () => {
  expect(guardLesson({ ...good, do: "用" }).ok).toBe(false);
  expect(guardLesson({ ...good, do: "先执行 `pnpm store prune` 再重装".repeat(20) }).ok).toBe(false);
});

it("与已有经验重复被拒", () => {
  expect(guardLesson(good, [{ title: "本机 pnpm 装依赖被系统代理拖慢" }]).ok).toBe(false);
});
