/**
 * 打开会话时的图片占用统计**不该**把会话变成活跃。
 *
 * 回归点（2026-10-30）：ChatPanel 打开会话就调 contextImageStats，而该接口原先在未激活时
 * 先 activateSession 再回答——于是"只是看一眼"也会 resume 整份 jsonl（本仓库有 51MB 的会话），
 * 侧栏状态点随之变绿、内存常驻，关掉后还要等 2 分钟才回收。用户看到的就是
 * 「打开还没发消息，过一会儿自己激活了；关上过一会儿又激活，再两分钟才结束」。
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentService } from "./agent-service";
import type { Store } from "./store";

vi.mock("electron", () => ({ app: { isPackaged: false, getPath: () => "/tmp" }, BrowserWindow: { getAllWindows: () => [] } }));
vi.mock("./ipc-broadcast", () => ({ broadcast: vi.fn() }));
// 真实的 listPiSessions 会按 cwd 在 ~/.easymint/agent/sessions/ 下建目录（Pi 的 SM.list 行为），
// 于是每次跑这个用例都用临时路径在真实 home 里留一个空目录（实测攒了 38 个）。
// 这里只需要"查不到这条会话"，不必真的碰会话库。
vi.mock("./pi-session", () => ({
  createPiSession: vi.fn(),
  resumePiSession: vi.fn(),
  disposePiSession: vi.fn(),
  listPiSessions: async () => [],
}));

function create(): AgentService {
  return new AgentService({ getSettings: () => ({ learnEnabled: true }) } as unknown as Store);
}

describe("context image stats", () => {
  it("未激活时只读磁盘，不触发按需激活、也不留下活跃会话", async () => {
    const service = create();
    const activate = vi.spyOn(service, "activateSession");
    const root = mkdtempSync(path.join(os.tmpdir(), "em-ctx-image-"));
    try {
      const result = await service.getContextImageStats("not-there", root);

      expect(result.ok).toBe(false); // 会话不存在，如实报错
      expect(activate).not.toHaveBeenCalled(); // 关键：没有再"为了回答统计"去 resume
      expect((service as unknown as { findActiveChat(id: string): unknown }).findActiveChat("not-there"))
        .toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
