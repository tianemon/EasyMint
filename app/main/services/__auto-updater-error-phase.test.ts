import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 自动更新的失败阶段归因。
 *
 * 背景：`UpdateStatusPayload` 早就带了 `errorMessage` / `errorPhase`，但后端**从来只填 "check"**
 * （下载阶段出错也写死 check），前端也因此拿不到可用信息、只显示一句固定文案。这组用例钉住
 * 「按是否已进过下载阶段归因」这条链路，避免它再次静默退化。
 */

const mocks = vi.hoisted(() => {
  const sent: Array<Record<string, unknown>> = [];
  const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
  const emitter = {
    on: (name: string, fn: (arg?: unknown) => void): void => { (handlers[name] ||= []).push(fn); },
    emit: (name: string, arg?: unknown): void => { for (const fn of handlers[name] ?? []) fn(arg); },
    autoDownload: false,
    autoInstallOnAppQuit: false,
    quitAndInstall: vi.fn(),
  };
  const reset = (): void => {
    for (const key of Object.keys(handlers)) delete handlers[key];
    sent.length = 0;
  };
  return { sent, emitter, reset, openExternal: vi.fn(async () => {}) };
});

vi.mock("electron", () => ({
  app: { isPackaged: true, getVersion: () => "0.0.0", getPath: () => "/tmp/em-updater-phase-test" },
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { send: (_channel: string, payload: Record<string, unknown>) => { mocks.sent.push(payload); } },
    }],
  },
  shell: { openPath: () => {}, openExternal: mocks.openExternal },
}));

vi.mock("electron-updater", () => ({ autoUpdater: mocks.emitter }));

import { autoUpdaterInternals, installUpdate } from "./auto-updater";

describe("自动更新失败的阶段归因", () => {
  beforeEach(() => { mocks.reset(); });

  it("检测阶段失败 ⇒ errorPhase 为 check，且带上失败原因", () => {
    autoUpdaterInternals.setupListeners();
    mocks.emitter.emit("checking-for-update");
    mocks.emitter.emit("error", new Error("ENOTFOUND registry.example.com"));

    expect(mocks.sent.at(-1)).toMatchObject({
      status: "error",
      errorPhase: "check",
      errorMessage: "ENOTFOUND registry.example.com",
    });
  });

  it("已进过下载阶段后失败 ⇒ errorPhase 为 download（修复前这里恒为 check）", () => {
    autoUpdaterInternals.setupListeners();
    mocks.emitter.emit("checking-for-update");
    mocks.emitter.emit("update-available", { version: "9.9.9" });
    mocks.emitter.emit("download-progress", { percent: 12, transferred: 1, total: 8 });
    mocks.emitter.emit("error", new Error("socket hang up"));

    expect(mocks.sent.at(-1)).toMatchObject({ status: "error", errorPhase: "download" });
  });

  it("只发现新版本、尚未开始下载时失败 ⇒ 仍归检测阶段", () => {
    autoUpdaterInternals.setupListeners();
    mocks.emitter.emit("checking-for-update");
    mocks.emitter.emit("update-available", { version: "9.9.9" });
    mocks.emitter.emit("error", new Error("metadata fetch failed"));

    expect(mocks.sent.at(-1)).toMatchObject({ errorPhase: "check" });
  });

  it("新一轮检测会把阶段归零（上一轮的下载不污染本轮）", () => {
    autoUpdaterInternals.setupListeners();
    mocks.emitter.emit("checking-for-update");
    mocks.emitter.emit("update-available", { version: "9.9.9" });
    mocks.emitter.emit("download-progress", { percent: 12, transferred: 1, total: 8 });
    mocks.emitter.emit("checking-for-update");
    mocks.emitter.emit("error", new Error("boom"));

    expect(mocks.sent.at(-1)).toMatchObject({ errorPhase: "check" });
  });

  it("Linux opens the release download page without starting an installer", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...platform, value: "linux" });
    try {
      autoUpdaterInternals.setupListeners();
      mocks.emitter.emit("update-downloaded", { version: "9.9.9" });
      installUpdate();
      expect(mocks.openExternal).toHaveBeenCalledWith("https://github.com/tianemon/EasyMint/releases/latest");
      expect(mocks.emitter.quitAndInstall).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(mocks.sent.at(-1)).toMatchObject({ status: "idle" }));
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });
});
