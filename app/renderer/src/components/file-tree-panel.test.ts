// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileTreePanel } from "./FileTreePanel";

type Reply = { nodes: Array<{ name: string; path: string; isDirectory: boolean }>; truncated: boolean };
let container: HTMLDivElement, root: Root;
let pending: Array<{ resolve: (value: Reply) => void; reject: (error: Error) => void }>;
const readTree = vi.fn();
const reply = (name: string, truncated = false): Reply => ({ nodes: [{ name, path: `/fixture/${name}`, isDirectory: false }], truncated });
const render = (refreshToken = 0, projectPath = "/fixture") => act(async () => root.render(createElement(FileTreePanel, { projectPath, refreshToken })));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  pending = [];
  readTree.mockReset().mockImplementation(() => new Promise<Reply>((resolve, reject) => pending.push({ resolve, reject })));
  Object.assign(window, { electronAPI: { file: { readTree } } });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("retains cached rows while refreshing, and ignores stale successes including their truncation state", async () => {
  await render(); await act(async () => pending[0]!.resolve(reply("cached.txt")));
  await render(1); expect(container.textContent).toContain("cached.txt");
  await render(2); await act(async () => pending[2]!.resolve(reply("new.txt")));
  await act(async () => pending[1]!.resolve(reply("old.txt", true)));
  expect(container.textContent).toContain("new.txt");
  expect(container.textContent).not.toContain("old.txt");
  expect(container.textContent).toBe("new.txt");
});

it("ignores a stale rejection but displays failure of the latest request and supports retry", async () => {
  await render(); await render(1);
  await act(async () => pending[1]!.resolve(reply("new.txt")));
  await act(async () => pending[0]!.reject(new Error("stale failure")));
  expect(container.textContent).toContain("new.txt");
  expect(container.textContent).not.toContain("stale failure");
  await render(2); await act(async () => pending[2]!.reject(new Error("latest failure")));
  expect(container.textContent).toContain("latest failure");
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => pending[3]!.resolve(reply("recovered.txt")));
  expect(container.textContent).toContain("recovered.txt");
});

it("clears the prior project's rows and ignores its late response after a project switch", async () => {
  await render(); await act(async () => pending[0]!.resolve(reply("project-a.txt")));
  await render(1); await render(1, "/other-project");
  expect(container.textContent).not.toContain("project-a.txt");
  await act(async () => pending[2]!.resolve(reply("project-b.txt")));
  await act(async () => pending[1]!.resolve(reply("late-a.txt")));
  expect(container.textContent).toContain("project-b.txt");
  expect(container.textContent).not.toContain("late-a.txt");
});
