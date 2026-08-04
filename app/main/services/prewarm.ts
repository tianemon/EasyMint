/**
 * 冷启动预热 — 首条消息发送前,后台预加载初始化资源,填充进程级缓存。
 *
 * 首条消息慢的根因:Pi SDK 懒加载、Model runtime/provider 同步、MCP 工具连接
 * 都在 sendMessage 首次调用时现场执行。预热提前触发,之后发送走缓存,立即可用。
 *
 * 只做一次(进程级 flag);失败容错(不阻塞启动,首条消息会现场加载)。
 */

import { getModelRuntime, getActiveModel } from "./pi-init";
import { loadMcpTools } from "./permission/mcp-adapter";
import type { Store } from "./store";

let prewarmed = false;

export async function prewarm(store: Store): Promise<void> {
  if (prewarmed) return;
  prewarmed = true;
  try {
    // 顺序:SDK + model runtime(含 provider 同步)→ model → MCP 工具连接
    await getModelRuntime(store);
    await getActiveModel(store);
    await loadMcpTools();
    console.log("[prewarm] 预热完成:SDK/model/MCP 已就绪");
  } catch (e) {
    // 预热失败不阻塞启动——首条消息发送时会现场加载
    console.warn("[prewarm] 预热失败(首条消息将现场加载):", (e as Error).message);
  }
}
