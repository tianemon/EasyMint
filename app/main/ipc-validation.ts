/**
 * IPC 入参运行时校验中间层（1.7）——zod schema 守卫。
 *
 * 渲染层传什么主进程就收什么 → 类型错误/畸形 payload 会造成静默失败或意外行为。
 * 对文件/路径/命令类高风险通道统一加校验：失败抛出带原因的明确错误（渲染层 promise 拒绝），
 * 而非静默吞掉。schema 一律 `.loose()`——只校验安全关键字段，容忍未覆盖的附加键，避免误伤合法调用。
 */

import { z } from "zod";

/** 常见基础 schema */
export const nonEmptyString = z.string().min(1, "不能为空");
export const maybeString = z.string().optional();
export const pathString = z.string().min(1, "路径不能为空").max(4096);
export const portNumber = z.number().int().min(0).max(65535);

/** 解析参数并返回校验后数据；失败抛明确错误（带字段路径与原因） */
export function expectPayload<T>(schema: z.ZodType<T>, args: unknown): T {
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path?.length ? issue.path.join(".") : "参数";
    throw new Error(`IPC 参数校验失败: ${field} ${issue?.message ?? "不合法"}`);
  }
  return parsed.data;
}

/** 包装 ipcMain.handle：外层签名 (event, payload)；校验通过才执行 fn */
export function guard<T, R>(
  schema: z.ZodType<T>,
  fn: (data: T) => R,
): (_event: unknown, payload: unknown) => R {
  return (_event, payload) => fn(expectPayload(schema, payload));
}
