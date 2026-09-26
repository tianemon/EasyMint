import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BrowserWindow } from "electron";

/**
 * 主窗口几何状态的记忆（大小 / 位置 / 是否最大化）。
 *
 * 此前 macOS 每次启动都无条件 `maximize()`（`index.ts` 的 createWindow），用户手动调整过的
 * 窗口尺寸在重启后被重置。现在：有记录 → 恢复用户最后一次的状态；无记录（首次启动）→ 调用方
 * 保持既有默认行为（macOS 仍「启动即铺满」）。
 *
 * 落盘位置 `userData/window-state.json`：userData 已被重定向到 `~/.easymint/electron`
 * （见 index.ts 的 `app.setPath("userData", …)`），与 `update-downloaded.json` 同一处——属应用
 * 自身的 UI 状态，不是需要登记与保护的 `~/.easymint` 业务数据，故 check:em-home 无需登记。
 *
 * 只服务主窗口：多窗口共存时同一份记录会被互相覆盖，且恢复旧几何会让新窗口叠在主窗口上。
 */

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState extends WindowRect {
  maximized: boolean;
}

/** 与 BrowserWindow 的 minWidth/minHeight 同源——恢复时按同一组下限夹取，避免磁盘上的旧值小于下限。 */
export const WINDOW_MIN_WIDTH = 1024;
export const WINDOW_MIN_HEIGHT = 700;

/** 恢复后至少要露出这么多像素才算「这块屏还看得见它」：外接屏拔掉后旧坐标会把窗口丢到屏幕外。 */
const MIN_VISIBLE = 100;

/** 几何变化写盘的防抖间隔（拖动缩放期间不逐帧写）。 */
const SAVE_DEBOUNCE_MS = 500;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 校验磁盘上的记录并规整：字段齐全且有限、尺寸不小于窗口下限、与某块屏幕的工作区有足够重叠。
 * 任一条不满足返回 null —— 调用方按「无记录」处理（保持默认启动行为，不把窗口丢在屏幕外）。
 */
export function normalizeWindowState(raw: unknown, workAreas: WindowRect[]): WindowState | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  if (!isFiniteNumber(source.x) || !isFiniteNumber(source.y)
    || !isFiniteNumber(source.width) || !isFiniteNumber(source.height)) return null;

  const width = Math.max(Math.round(source.width), WINDOW_MIN_WIDTH);
  const height = Math.max(Math.round(source.height), WINDOW_MIN_HEIGHT);
  const x = Math.round(source.x);
  const y = Math.round(source.y);

  const visible = workAreas.some((area) => x + width > area.x + MIN_VISIBLE
    && x < area.x + area.width - MIN_VISIBLE
    && y + height > area.y + MIN_VISIBLE
    && y < area.y + area.height - MIN_VISIBLE);
  if (!visible) return null;

  return { x, y, width, height, maximized: source.maximized === true };
}

function statePath(): string {
  // 延迟取 electron：本模块的校验部分是纯函数，单测里不引入 electron 运行时
  const { app } = require("electron") as typeof import("electron");
  return path.join(app.getPath("userData"), "window-state.json");
}

export function readWindowState(): WindowState | null {
  const file = statePath();
  if (!existsSync(file)) return null; // 首次启动：交给调用方的默认行为

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    // 用户手改或写坏的配置文件属可预期场景：丢弃记录走默认行为，并留下可诊断的日志
    console.warn("[window-state] 状态文件解析失败，按无记录处理:", error instanceof Error ? error.message : String(error));
    return null;
  }

  const { screen } = require("electron") as typeof import("electron");
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  return normalizeWindowState(raw, workAreas);
}

/**
 * 跟踪窗口几何并写盘：几何变化按防抖写，「关闭」时立即写一次（覆盖 Cmd+Q 这类
 * 不触发几何事件的退出）。`getNormalBounds()` 在最大化/最小化时给的是还原后的几何，
 * 正是下次要恢复的值。
 */
export function trackWindowState(window: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;

  const save = (): void => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (window.isDestroyed()) return;
    const state: WindowState = { ...window.getNormalBounds(), maximized: window.isMaximized() };
    writeFileSync(statePath(), JSON.stringify(state, null, 2));
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };

  // 逐个注册：BrowserWindow.on 的签名按事件名重载，传联合类型无法通过类型检查
  window.on("resize", schedule);
  window.on("move", schedule);
  window.on("maximize", schedule);
  window.on("unmaximize", schedule);
  window.on("close", save);
  window.on("closed", () => {
    if (timer) { clearTimeout(timer); timer = null; }
  });
}
