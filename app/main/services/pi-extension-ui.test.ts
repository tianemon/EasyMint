import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { answerPiExtensionPrompt, bindPiExtensionWindow, createPiExtensionUi } from "./pi-extension-ui";

type Listener = (...args: unknown[]) => void;

interface MockWindow {
  senderId: number;
  url: string;
  destroyed: boolean;
  listeners: Map<string, Listener[]>;
}

const windows: MockWindow[] = [];
const sent: Array<{ senderId: number; channel: string; id?: string; kind?: string; title?: string; message?: string; type?: string }> = [];

function makeWindow(senderId: number, url: string): MockWindow {
  const win: MockWindow = { senderId, url, destroyed: false, listeners: new Map() };
  windows.push(win);
  return win;
}

function emit(win: MockWindow, channel: string, ...args: unknown[]): void {
  for (const listener of win.listeners.get(channel) ?? []) listener({}, ...args);
}

function electronWindow(win: MockWindow) {
  const webContents = {
    id: win.senderId,
    isDestroyed: () => win.destroyed,
    getURL: () => win.url,
    send: (channel: string, payload: { id?: string; kind?: string; title?: string; message?: string; type?: string }) =>
      sent.push({ senderId: win.senderId, channel, ...payload }),
    on: (channel: string, listener: Listener) => {
      win.listeners.set(channel, [...(win.listeners.get(channel) ?? []), listener]);
    },
    removeListener: (channel: string, listener: Listener) => {
      win.listeners.set(channel, (win.listeners.get(channel) ?? []).filter((item) => item !== listener));
    },
  };
  return {
    isDestroyed: () => win.destroyed,
    webContents,
    on: (channel: string, listener: Listener) => {
      win.listeners.set(channel, [...(win.listeners.get(channel) ?? []), listener]);
    },
    removeListener: (channel: string, listener: Listener) => {
      win.listeners.set(channel, (win.listeners.get(channel) ?? []).filter((item) => item !== listener));
    },
  };
}

vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => windows.filter((win) => !win.destroyed).map(electronWindow),
  },
}));

beforeEach(() => {
  windows.length = 0;
  sent.length = 0;
});

const projectUrl = (id: string) => `http://localhost:5173/#/project/${id}`;

describe("Pi extension UI bridge", () => {
  it("accepts a prompt answer only from the target window", async () => {
    makeWindow(42, projectUrl("proj-a"));
    makeWindow(99, projectUrl("proj-b"));
    bindPiExtensionWindow("/tmp/pi-project-a", 42);
    const ui = createPiExtensionUi("/tmp/pi-project-a");
    const pendingAnswer = ui.confirm("Approve?", "run action");
    expect(sent.at(-1)).toMatchObject({ senderId: 42, channel: "pi-extension:prompt", kind: "confirm", title: "Approve?" });
    const id = sent.at(-1)!.id!;
    answerPiExtensionPrompt(99, id, true);
    answerPiExtensionPrompt(42, id, true);
    await expect(pendingAnswer).resolves.toBe(true);
    const count = sent.length;
    await expect(createPiExtensionUi("/tmp/unbound-project").confirm("Other", "message")).resolves.toBe(false);
    expect(sent).toHaveLength(count);
  });

  it("routes prompts of two projects to their own windows", async () => {
    makeWindow(42, projectUrl("proj-a"));
    makeWindow(99, projectUrl("proj-b"));
    bindPiExtensionWindow("/tmp/pi-project-a", 42);
    bindPiExtensionWindow("/tmp/pi-project-b", 99);
    void createPiExtensionUi("/tmp/pi-project-a").confirm("A", "msg");
    void createPiExtensionUi("/tmp/pi-project-b").confirm("B", "msg");
    expect(sent.find((item) => item.title === "A")?.senderId).toBe(42);
    expect(sent.find((item) => item.title === "B")?.senderId).toBe(99);
  });

  it("revokes the binding and settles pending prompts when the window navigates to another project", async () => {
    const win = makeWindow(42, projectUrl("proj-a"));
    bindPiExtensionWindow("/tmp/pi-project-a", 42);
    const pendingAnswer = createPiExtensionUi("/tmp/pi-project-a").confirm("Approve?", "run action");
    const id = sent.at(-1)!.id!;
    // 同一窗口从项目 A 导航到项目 B（webContents id 不变）
    win.url = projectUrl("proj-b");
    emit(win, "did-navigate-in-page", win.url);
    // 待答请求被结算为取消（不必等 5 分钟超时），渲染层收到过期通知
    await expect(pendingAnswer).resolves.toBe(false);
    expect(sent.at(-1)).toMatchObject({ senderId: 42, channel: "pi-extension:prompt-expired", id });
    // 导航后 A 的扩展请求不再显示在该窗口，也不退回焦点窗口
    const count = sent.length;
    await expect(createPiExtensionUi("/tmp/pi-project-a").confirm("Later", "msg")).resolves.toBe(false);
    expect(sent).toHaveLength(count);
    // 迟到的回复被忽略
    answerPiExtensionPrompt(42, id, true);
    expect(sent).toHaveLength(count);
  });

  it("keeps the binding on in-page navigation within the same project", async () => {
    const win = makeWindow(42, projectUrl("proj-a"));
    bindPiExtensionWindow("/tmp/pi-project-a", 42);
    win.url = `${projectUrl("proj-a")}?tab=session-1`;
    emit(win, "did-navigate-in-page", win.url);
    const pendingAnswer = createPiExtensionUi("/tmp/pi-project-a").confirm("Still", "here");
    expect(sent.at(-1)).toMatchObject({ senderId: 42, channel: "pi-extension:prompt" });
    answerPiExtensionPrompt(42, sent.at(-1)!.id!, true);
    await expect(pendingAnswer).resolves.toBe(true);
  });

  it("settles pending prompts when the bound window is closed", async () => {
    const win = makeWindow(42, projectUrl("proj-a"));
    bindPiExtensionWindow("/tmp/pi-project-a", 42);
    const pendingAnswer = createPiExtensionUi("/tmp/pi-project-a").confirm("Approve?", "run action");
    win.destroyed = true;
    emit(win, "closed");
    await expect(pendingAnswer).resolves.toBe(false);
    const count = sent.length;
    await expect(createPiExtensionUi("/tmp/pi-project-a").confirm("Later", "msg")).resolves.toBe(false);
    expect(sent).toHaveLength(count);
  });

  it("settles the old window's pending prompts when the project rebinds to a new window", async () => {
    const w1 = makeWindow(42, projectUrl("proj-a"));
    makeWindow(77, projectUrl("proj-a"));
    bindPiExtensionWindow("/tmp/pi-project-a", 42);
    const pendingAnswer = createPiExtensionUi("/tmp/pi-project-a").confirm("Approve?", "run action");
    const id = sent.at(-1)!.id!;
    // 同一项目改绑到 W2：W1 的待答请求被结算为取消，并收到过期通知撤掉弹窗
    bindPiExtensionWindow("/tmp/pi-project-a", 77);
    await expect(pendingAnswer).resolves.toBe(false);
    expect(sent.at(-1)).toMatchObject({ senderId: 42, channel: "pi-extension:prompt-expired", id });
    // W1 随后导航到其它项目：旧弹窗不能被回答（已结算）
    w1.url = projectUrl("proj-b");
    emit(w1, "did-navigate-in-page", w1.url);
    answerPiExtensionPrompt(42, id, true);
    // 改绑后 A 项目的新请求正常发给 W2（由 W2 的回复结算，不悬挂）
    const nextRequest = createPiExtensionUi("/tmp/pi-project-a").confirm("Next", "msg");
    const next = sent.find((item) => item.channel === "pi-extension:prompt" && item.title === "Next")!;
    expect(next.senderId).toBe(77);
    answerPiExtensionPrompt(77, next.id!, false);
    await expect(nextRequest).resolves.toBe(false);
  });

  it("re-checks the window project right before sending even if the navigation event was missed", async () => {
    const win = makeWindow(42, projectUrl("proj-a"));
    bindPiExtensionWindow("/tmp/pi-project-a", 42);
    // 导航事件丢失（竞态）：URL 已变但监听器未触发
    win.url = projectUrl("proj-b");
    await expect(createPiExtensionUi("/tmp/pi-project-a").confirm("Approve?", "msg")).resolves.toBe(false);
    expect(sent.some((item) => item.channel === "pi-extension:prompt")).toBe(false);
  });

  it("silences MCP attention notices so they never become chat toasts", () => {
    makeWindow(7, projectUrl("proj-mcp"));
    bindPiExtensionWindow("/tmp/pi-project-mcp", 7);
    const ui = createPiExtensionUi("/tmp/pi-project-mcp");
    const warning = "MCP servers need attention:\n  codegraph: failed: MCP connection closed\nRun /mcp to fix.";
    ui.notify(warning, "warning");
    expect(sent).toHaveLength(0);
    // pi 只改其中一半文案时同样静默（两个特征任一命中）
    ui.notify("note\nRun /mcp to fix.", "warning");
    expect(sent).toHaveLength(0);
    // 其它通知照旧送达
    ui.notify("插件已加载", "info");
    expect(sent.at(-1)).toMatchObject({ senderId: 7, channel: "pi-extension:notice", message: "插件已加载", type: "info" });
  });

  // isMcpAttentionNotice 是按文案特征静默的（pi 没有给这条通知结构化标识），所以升级 SDK 后
  // 若 pi 改了措辞，静默会悄悄失效、提醒重新弹回聊天。这条锚定已安装 SDK 里 MCP 扩展的真实文案：
  // 变红不是代码坏了，而是要求复核 isMcpAttentionNotice 的特征串。
  it("still matches the wording the installed pi uses for MCP problems (upgrade check)", () => {
    const require = createRequire(path.join(__dirname, "anchor.cjs"));
    const file = (require.resolve.paths("@earendil-works/pi-coding-agent") ?? [])
      .map((root) => path.join(root, "@earendil-works", "pi-coding-agent", "dist", "extensions", "mcp", "index.js"))
      .find((candidate) => fs.existsSync(candidate));
    if (!file) throw new Error("找不到已安装 pi 的 MCP 扩展文件，升级 SDK 后请复核本测试");
    const source = fs.readFileSync(file, "utf8");
    expect(source).toContain("MCP servers need attention");
    expect(source).toContain("Run /mcp to fix.");
  });
});
