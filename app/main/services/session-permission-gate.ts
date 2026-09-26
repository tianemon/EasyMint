import { normalizePermissionMode } from "./permission/execution-context";

/**
 * 会话创建与权限提交的互斥锁（Pi 原生扩展集成方案 · 复查第二轮 #2）。
 *
 * 竞态本质：`await loader.reload()` 是单个 await，其内部的「jiti import（模块顶层副作用）→
 * 工厂执行」之间没有可插入检查的同步点——主进程收到切档 IPC 后无法撤销 reload 内已执行的
 * 代码。唯一可靠的顺序保证是把「权限提交」与「创建+登记」串行化：提交要么在创建开始前
 * 完成（创建时实时门看到 standard，不加载扩展），要么排队到创建完成、活跃会话已登记之后
 * （此时 session-cache:write 的 schedulePermissionToolRebuild 一定能找到会话并安排关闭，
 * 不再落空）。工厂执行时若提交仍在排队，语义上 standard 尚未生效——顺序自洽。
 *
 * 死锁纪律：fn 内不得再调用本锁（sendMessage 的创建段与 session-cache:write / 远程切档
 * 的提交段是平级使用者，互相不嵌套）。
 */
let creationLockTail: Promise<void> = Promise.resolve();

export function withSessionCreationLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = creationLockTail.then(fn, fn);
  creationLockTail = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * 会话创建期间权限收紧的协调点（Pi 原生扩展集成方案 · 复查待修清单 #2）。
 *
 * 竞态：以 full 开始异步创建会话，创建期间用户切到 standard——session-cache:write 的
 * schedulePermissionToolRebuild 找不到尚未登记的活跃会话而落空，创建完成的会话仍绑定扩展。
 *
 * 门禁在创建完成后复核实时模式：只有 full → 非 full 需要处理（可执行扩展只在 full 加载），
 * 此时弃用按旧模式创建的会话并按收紧后的模式重建，保证 standard 一旦生效，
 * 不留已绑定扩展的空闲会话。放宽方向（非 full → full）不重建——扩展不加载是安全侧，
 * 沿用「启停在新建或重新打开的会话生效」的既有约定。
 *
 * 注意：只处理「创建中」的会话，绝不动正在输出主回答的活跃会话（权限切换不打断回答）。
 * 主防线是 withSessionCreationLock 的串行化——提交被推迟到登记后，本门禁是纵深防御。
 */
export async function createWithPermissionGate<T>(args: {
  initialMode: string | undefined;
  readLiveMode: () => string | undefined;
  create: (mode: string | undefined) => Promise<T>;
  dispose: (session: T) => Promise<void>;
  onStale?: () => void;
}): Promise<T> {
  let mode = args.initialMode;
  let session = await args.create(mode);
  while (normalizePermissionMode(mode) === "full") {
    const live = args.readLiveMode();
    if (normalizePermissionMode(live) === "full") break;
    args.onStale?.();
    await args.dispose(session);
    mode = live;
    session = await args.create(mode);
  }
  return session;
}
