/**
 * 冷启动预热 — 首条消息发送前,后台预加载初始化资源,填充进程级缓存。
 *
 * 提前准备 Pi SDK 和模型运行时；MCP 保持按需连接，不因预热启动全部服务器。
 *
 * 只做一次(进程级 flag);失败容错(不阻塞启动,首条消息会现场加载)。
 */

import { getModelRuntime, getActiveModel } from "./pi-init";
import type { Store } from "./store";

let prewarmed = false;

export async function prewarm(store: Store): Promise<void> {
  if (prewarmed) return;
  prewarmed = true;
  try {
    // MCP 按需连接；预热仅准备模型，避免空闲时拉起全部 MCP 子进程。
    await getModelRuntime(store);
    await getActiveModel(store);
  } catch (e) {
    // 预热失败不阻塞启动——首条消息发送时会现场加载
    console.warn("[prewarm] 预热失败(首条消息将现场加载):", (e as Error).message);
  }
}
