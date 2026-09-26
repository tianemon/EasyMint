import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "./store";
import { createPiSession, resumePiSession, listPiSessions, disposePiSession } from "./pi-session";
import { discoverAvailableExtensions, setPiExtensionApproved } from "./pi-extension-service";
import { withSessionCreationLock } from "./session-permission-gate";
import { writeCache, readCache, deleteCache } from "./session-cache";

/**
 * 创建会话期间切档的竞态（Pi 原生扩展集成方案 · 复查待修清单 #2 与复查第二轮 #2）——pi-session 侧：
 * buildSession 的实时权限门必须在 standard 正式提交后阻止扩展工厂执行；
 * `await loader.reload()` 内部的工厂执行窗口由 withSessionCreationLock 串行化消除——
 * 切档提交被锁推迟到「创建+登记」之后，标准模式提交不会发生在工厂执行之前。
 */

vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => os.tmpdir() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
}));

// 部分 mock：用受控 Promise 暂停扩展发现（buildSession 的一个异步边界），
// 其余函数（recordPiExtensionError/Stats、setPiExtensionApproved 等）走真实实现。
vi.mock("./pi-extension-service", async (importOriginal) => {
  const original = await importOriginal<typeof import("./pi-extension-service")>();
  return { ...original, discoverAvailableExtensions: vi.fn(original.discoverAvailableExtensions) };
});

// vi.hoisted：mock 工厂在模块初始化前执行，gate 状态必须先于它可用。
const reloadGateState = vi.hoisted(() => ({
  gate: null as null | { promise: Promise<void>; resolve: () => void; entered: () => void },
}));

// 部分 mock：让 DefaultResourceLoader.reload() 在入口处等待受控门——
// 模拟「切档提交发生在 await reload() 执行期间」的窗口。
vi.mock("./pi-sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("./pi-sdk")>();
  return {
    ...original,
    getDefaultResourceLoaderClass: vi.fn(async () => {
      const Real = await original.getDefaultResourceLoaderClass();
      return class GatedDRL extends Real {
        async reload(options?: Parameters<InstanceType<typeof Real>["reload"]>[0]): Promise<void> {
          const gate = reloadGateState.gate;
          if (gate) { gate.entered(); await gate.promise; }
          return super.reload(options);
        }
      };
    }),
  };
});

function installReloadGate(): { entered: Promise<void>; release: () => void } {
  let resolveGate!: () => void;
  let markEntered!: () => void;
  const promise = new Promise<void>((resolve) => { resolveGate = resolve; });
  const entered = new Promise<void>((resolve) => { markEntered = resolve; });
  reloadGateState.gate = { promise, resolve: resolveGate, entered: markEntered };
  return { entered, release: resolveGate };
}

const roots: string[] = [];
const originalEmHome = process.env.EASYMINT_HOME;
const originalPiDir = process.env.PI_CODING_AGENT_DIR;
afterEach(() => {
  if (originalEmHome === undefined) delete process.env.EASYMINT_HOME; else process.env.EASYMINT_HOME = originalEmHome;
  if (originalPiDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = originalPiDir;
  vi.restoreAllMocks();
  reloadGateState.gate = null;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function setupApprovedExtension() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "em-pi-gate-"));
  roots.push(root);
  vi.spyOn(os, "homedir").mockReturnValue(root);
  const emDir = path.join(root, ".easymint");
  const agentDir = path.join(emDir, "agent");
  const cwd = path.join(root, "project");
  process.env.EASYMINT_HOME = emDir;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  fs.mkdirSync(cwd, { recursive: true });
  const nativeExt = path.join(root, ".pi", "agent", "extensions", "native.ts");
  fs.mkdirSync(path.dirname(nativeExt), { recursive: true });
  // 两道防线分别锚定：模块顶层副作用 = loader 加载（loader 前复核）；
  // 工厂执行 = bindExtensions（reload 后复核）
  const topMarker = path.join(root, "module-loaded.txt");
  const factoryMarker = path.join(root, "factory-ran.txt");
  fs.writeFileSync(nativeExt, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(topMarker)}, 't'); export default (pi) => { fs.appendFileSync(${JSON.stringify(factoryMarker)}, 'f'); pi.registerTool({ name: 'native_tool', label: 'Native', description: 'fixture', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: undefined }) }); };`);
  const native = (await discoverAvailableExtensions({ projectPath: cwd, settingsDir: emDir })).find((item) => item.name === "native")!;
  await setPiExtensionApproved(native.id, native.fingerprint, true, { projectPath: cwd, settingsDir: emDir });
  return { root, emDir, agentDir, cwd, topMarker, factoryMarker };
}

/** 让扩展发现停在一次受控的异步边界上，返回「放行」与「已进入暂停点」两个钩子 */
function pauseDiscovery() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const mocked = vi.mocked(discoverAvailableExtensions);
  // 只把「设置本实现之后」的调用算作进入暂停点——setup 阶段的授权流程也调 discover
  const base = mocked.mock.calls.length;
  mocked.mockImplementation(async (options) => {
    await gate;
    const actual = await vi.importActual<typeof import("./pi-extension-service")>("./pi-extension-service");
    return actual.discoverAvailableExtensions(options);
  });
  return { release, entered: () => mocked.mock.calls.length > base };
}

describe("Pi session 创建期间切档的扩展门禁", () => {
  it("对照组：保持 full 时扩展模块加载且工厂执行（证明测试可失败）", async () => {
    const { emDir, agentDir, cwd, topMarker, factoryMarker } = await setupApprovedExtension();
    pauseDiscovery().release();
    const session = await createPiSession({ cwd, agentDir, store: new Store(emDir), permissionMode: "full", getPermissionMode: () => "full" });
    expect(fs.existsSync(topMarker)).toBe(true);
    expect(fs.existsSync(factoryMarker)).toBe(true);
    expect(session.agent.state.tools.some((tool) => tool.name === "native_tool")).toBe(true);
    await disposePiSession(session);
  }, 30000);

  it("新会话：暂停期写入 standard → 模块不加载、工厂不执行、扩展工具不注册", async () => {
    const { emDir, agentDir, cwd, topMarker, factoryMarker } = await setupApprovedExtension();
    let liveMode = "full";
    const discovery = pauseDiscovery();
    const creating = createPiSession({ cwd, agentDir, store: new Store(emDir), permissionMode: "full", getPermissionMode: () => liveMode });
    await vi.waitFor(() => expect(discovery.entered()).toBe(true));
    // 模拟 session-cache:write 已把 standard 提交到会话缓存
    liveMode = "standard";
    discovery.release();
    const session = await creating;
    expect(fs.existsSync(topMarker)).toBe(false);
    expect(fs.existsSync(factoryMarker)).toBe(false);
    expect(session.agent.state.tools.some((tool) => tool.name === "native_tool")).toBe(false);
    await disposePiSession(session);
  }, 30000);

  it("恢复会话：初始化异步步骤中切档 → 模块与工厂同样不执行", async () => {
    const { emDir, agentDir, cwd, topMarker, factoryMarker } = await setupApprovedExtension();
    const store = new Store(emDir);
    // 先造一个可恢复的会话文件（SDK 只在有消息条目时才落盘——序列化内存条目手动写入）
    pauseDiscovery().release();
    const seed = await createPiSession({ cwd, agentDir, store, permissionMode: "standard" });
    seed.sessionManager.appendCustomEntry("seed");
    const seedFile = seed.sessionManager.getSessionFile()!;
    fs.mkdirSync(path.dirname(seedFile), { recursive: true });
    fs.writeFileSync(seedFile, [JSON.stringify(seed.sessionManager.getHeader()),
      ...seed.sessionManager.getEntries().map((entry) => JSON.stringify(entry))].join("\n") + "\n");
    await disposePiSession(seed);
    const info = (await listPiSessions(cwd))[0];
    expect(info).toBeDefined();
    let liveMode = "full";
    const discovery = pauseDiscovery();
    const creating = resumePiSession({
      cwd, agentDir, store, resumeSessionFile: info!.path,
      permissionMode: "full", getPermissionMode: () => liveMode,
    });
    await vi.waitFor(() => expect(discovery.entered()).toBe(true));
    liveMode = "standard";
    discovery.release();
    const session = await creating;
    expect(fs.existsSync(topMarker)).toBe(false);
    expect(fs.existsSync(factoryMarker)).toBe(false);
    expect(session.agent.state.tools.some((tool) => tool.name === "native_tool")).toBe(false);
    await disposePiSession(session);
  }, 30000);

  it("loader.reload() 执行期间切档：提交被锁推迟，扩展工厂执行于 standard 提交之前", async () => {
    const { emDir, agentDir, cwd, topMarker, factoryMarker } = await setupApprovedExtension();
    const store = new Store(emDir);
    const sid = "gate-order-session";
    writeCache(sid, { permissionMode: "full" });
    const events: string[] = [];
    const { entered, release } = installReloadGate();
    // 模拟 sendMessage 的「创建+登记」段持锁（真实代码路径：agent-service.withSessionCreationLock）
    const creating = withSessionCreationLock(async () => {
      const session = await createPiSession({
        cwd, agentDir, store, permissionMode: "full",
        getPermissionMode: () => readCache(sid)?.permissionMode,
      });
      events.push("created");
      return session;
    });
    await entered;
    // reload 进行中（工厂尚未执行、创建未完成）发起切档提交——模拟 session-cache:write
    // 带.permissionMode / 远程 setPermission 走同一把锁的完整时序
    const committing = withSessionCreationLock(async () => {
      events.push("commit-standard");
      writeCache(sid, { permissionMode: "standard" });
    });
    // 提交已发起但被锁挡住：工厂与提交都还没发生
    expect(events).toEqual([]);
    release();
    const session = await creating;
    // 创建按 full 完成：工厂在 reload 内、于提交之前执行（standard 尚未提交——语义自洽，
    // 提交排队到登记后由 schedulePermissionToolRebuild 安排关闭，不打断输出）
    expect(fs.existsSync(topMarker)).toBe(true);
    expect(fs.existsSync(factoryMarker)).toBe(true);
    expect(events).toEqual(["created"]);
    await committing;
    expect(events).toEqual(["created", "commit-standard"]);
    expect(readCache(sid)?.permissionMode).toBe("standard");
    await disposePiSession(session);
    deleteCache(sid);
  }, 30000);
});
