import { useState, useEffect, useRef } from "react";
import { HashRouter, Routes, Route } from "react-router-dom";
import { ProjectPage } from "./pages/ProjectPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MigrationIncomingModal } from "./components/device/MigrationIncomingModal";
import { PairRequestModal } from "./components/device/PairRequestModal";
import { useSettingsStore } from "./stores/settings-store";
import { useTabStore, type Tab } from "./stores/tab-store";
import { useDelegationStore } from "./stores/delegation-store";

export function App(): JSX.Element {
  const [setupComplete, setSetupComplete] = useState(
    localStorage.getItem("easymint_setup_complete") === "true"
  );
  // 接收端迁移弹窗(全局监听,不依赖具体项目页)
  const [incomingTransfer, setIncomingTransfer] = useState<{ transferId: string; fromName: string; projectName: string; fileCount: number; totalSize: number } | null>(null);
  // 发送端迁移回执提示(接收端恢复完成/失败)
  const [receipt, setReceipt] = useState<{ ok: boolean; text: string } | null>(null);

  // Restore persisted settings (model list, API keys, etc.) on startup.
  // Also fall back to main-process setupComplete if localStorage was lost
  // (e.g. after Electron userData path change or cache clear).
  useEffect(() => {
    useSettingsStore.getState().loadFromElectron().then(() => {
      const fromMain = useSettingsStore.getState().setupComplete;
      if (fromMain && !setupComplete) {
        localStorage.setItem("easymint_setup_complete", "true");
        setSetupComplete(true);
      }
    });
  }, []);

  // 切换供应商 → 活跃会话自动热切到新供应商默认模型。
  // resume 未激活会话不在主进程 activeChats(setModel 无效)但首次发送时自动用新供应商,无需处理。
  const currentProvider = useSettingsStore((s) => s.apiProviders?.current);
  const prevProviderRef = useRef(currentProvider);
  useEffect(() => {
    const prev = prevProviderRef.current;
    if (prev && currentProvider && prev !== currentProvider) {
      const cfg = useSettingsStore.getState().apiProviders?.configs?.[currentProvider];
      const newModel = cfg?.model || cfg?.models?.[0];
      if (newModel) {
        for (const t of useTabStore.getState().tabs) {
          if (t.type === "chat" && t.sessionId) {
            window.electronAPI.agent.setModel(t.sessionId, newModel).catch(() => {});
          }
        }
      }
    }
    prevProviderRef.current = currentProvider;
  }, [currentProvider]);

  // 委派/shell 状态全局订阅(App 常驻)——不能只在 ChatPanel 订阅:
  // 所有 tab 关闭时无订阅者,广播无人接收,store 残留旧状态,重开 tab 显示假活跃。
  // store 存全量(带 sessionId),组件按会话过滤。
  useEffect(() => {
    const off1 = window.electronAPI.agent.onDelegationCount((data) => {
      useDelegationStore.getState().setAgentTasks(data.tasks);
    });
    const off2 = window.electronAPI.agent.onShellCount((data) => {
      useDelegationStore.getState().setShellTasks(data);
    });
    return () => { off1(); off2(); };
  }, []);

  // 从主进程恢复 tab 状态（macOS 合盖 GPU 恢复时 localStorage 不可靠）
  useEffect(() => {
    const restore = async () => {
      try {
        // 新窗口不恢复旧窗口的标签页（URL 参数 fresh=1 标记）
        const hashQuery = window.location.hash.split("?")[1] || "";
        if (new URLSearchParams(hashQuery).get("fresh") === "1") {
          ensureDefaultTab();
          return;
        }
        const backup = await window.electronAPI?.tab?.restore?.();
        if (backup?.tabs?.length) {
          const store = useTabStore.getState();
          if (store.tabs.length === 0) {
            backup.tabs.forEach((t) => store.openTab(t as Tab));
            if (backup.activeTabId) store.setActiveTab(backup.activeTabId);
          }
        }
        // restore 后仍无 tab → 建初始空会话 tab(打开 EM = 聊天页,tab 条隐藏,发送后显示)
        ensureDefaultTab();
      } catch { /* ignore */ }
    };
    restore();
  }, []);

  // 打开 EM 无任何 tab 时,自动建一个"新会话"空 tab(与点新建会话一致,仅 tab 条隐藏)
  function ensureDefaultTab(): void {
    if (useTabStore.getState().tabs.length === 0) {
      useTabStore.getState().openTab({ id: `new-${Date.now()}`, type: "chat", title: "新会话" });
    }
  }

  useEffect(() => {
    const handler = () => setSetupComplete(true);
    window.addEventListener("easymint-setup-complete", handler);
    return () => window.removeEventListener("easymint-setup-complete", handler);
  }, []);

  // 接收端迁移弹窗事件订阅
  useEffect(() => {
    const unsubIncoming = window.electronAPI.migration.onIncoming((d) => {
      setIncomingTransfer(d);
    });
    return () => { unsubIncoming(); };
  }, []);

  // 发送端迁移回执订阅(接收端恢复完成 → 提示)
  useEffect(() => {
    const unsubReceipt = window.electronAPI.migration.onReceipt((d) => {
      setReceipt({
        ok: d.ok,
        text: d.ok
          ? `迁移完成: 已在目标设备恢复「${d.projectName ?? ""}」(${d.projectPath ?? ""})`
          : `迁移失败: ${(d.failures && d.failures.length > 0 ? d.failures.join("；") : "接收端恢复失败")}`,
      });
      setTimeout(() => setReceipt(null), 8000);
    });
    return () => { unsubReceipt(); };
  }, []);

  // 接收端迁移完成订阅 → 显示迁移完成卡片(模板文案 + 复制,用户粘贴发送给 Mint)
  const [migrateDone, setMigrateDone] = useState<{ projectName: string; projectPath: string; originPath: string; fromName: string } | null>(null);
  useEffect(() => {
    const unsubCompleted = window.electronAPI.migration.onCompleted((d) => {
      setMigrateDone(d);
    });
    return () => { unsubCompleted(); };
  }, []);

  // Windows 防火墙放行提示(设备互联,一次性,可关闭)
  const [firewallHint, setFirewallHint] = useState<number | null>(null);
  useEffect(() => {
    return window.electronAPI.onFirewallHint(({ port }) => setFirewallHint(port));
  }, []);

  return (
    <ErrorBoundary>
      <div id="app-shell">
        <HashRouter>
          {!setupComplete ? (
            <Routes>
              <Route path="*" element={<OnboardingPage />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/" element={<ProjectPage />} />
              <Route path="/project/:projectId" element={<ProjectPage />} />
            </Routes>
          )}
        </HashRouter>
        {/* 配对请求弹窗(全局,接收端确认) */}
        <PairRequestModal />
        {/* 迁移回执提示(发送端,3-5s 自动消失) */}
        {receipt && (
          <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2.5 rounded-lg border shadow-lg text-sm modal-card ${receipt.ok ? "bg-surface-alt border-border text-text-primary" : "bg-surface-alt border-danger/50 text-danger"}`}>
            {receipt.text}
          </div>
        )}
        {/* 迁移完成卡片(接收端):模板文案 + 复制,用户粘贴发送给 Mint 对齐上下文 */}
        {migrateDone && (
          <div className="fixed inset-0 z-[65] bg-black/40 flex items-center justify-center modal-overlay" onMouseDown={() => setMigrateDone(null)}>
            <div className="bg-surface-alt rounded-xl border border-border shadow-2xl modal-card flex flex-col" style={{ width: 520, maxHeight: "85vh" }} onMouseDown={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
                <h2 className="text-sm font-semibold text-text-primary">迁移完成</h2>
                <button className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors" onClick={() => setMigrateDone(null)}>✕</button>
              </div>
              <div className="px-5 py-2 text-xs text-text-secondary">
                「{migrateDone.projectName}」已恢复到本机（{migrateDone.projectPath}）。
                复制下方通知，发送给本项目会话的 Mint，让它了解环境变更。
              </div>
              <div className="px-5 py-2 flex-1 overflow-y-auto">
                <pre className="whitespace-pre-wrap text-[11px] leading-relaxed bg-surface rounded-lg border border-border p-3 text-text-primary">
{`【环境变更通知】

本项目已经迁移到另一台电脑，会话记录与项目文件已完整迁移。

原开发设备的会话历史、任务状态（task.json）、项目文件（docs/源码/配置）
都已同步到当前这台电脑。你现在所在的这台电脑，就是迁移的目标设备。

注意事项：
1. 项目路径已变更为 ${migrateDone.projectPath}——记忆中旧路径（${migrateDone.originPath}）已失效，读写以新路径为准
2. 原 git 仓库未迁移，需重新 git init；如有远程仓库（GitHub 等），重新配置 remote origin
3. 任务进度以 task.json 为唯一真相，重新核对（历史对话中的进度快照仅供参考）
4. 平台差异：换行符/可执行权限/包管理器/工具链按本机环境
5. 建议先读一遍项目结构（README/task.json/docs），确认环境后再继续`}
                </pre>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border shrink-0">
                <button className="px-4 py-1.5 rounded-lg text-text-secondary hover:bg-surface-hover transition-colors text-sm" onClick={() => setMigrateDone(null)}>
                  关闭
                </button>
                <button
                  className="px-5 py-1.5 rounded-lg bg-accent text-text-inverse hover:bg-accent-hover transition-colors text-sm font-medium"
                  onClick={async () => {
                    const text = `【环境变更通知】

本项目已经迁移到另一台电脑，会话记录与项目文件已完整迁移。

原开发设备的会话历史、任务状态（task.json）、项目文件（docs/源码/配置）
都已同步到当前这台电脑。你现在所在的这台电脑，就是迁移的目标设备。

注意事项：
1. 项目路径已变更为 ${migrateDone.projectPath}——记忆中旧路径（${migrateDone.originPath}）已失效，读写以新路径为准
2. 原 git 仓库未迁移，需重新 git init；如有远程仓库（GitHub 等），重新配置 remote origin
3. 任务进度以 task.json 为唯一真相，重新核对（历史对话中的进度快照仅供参考）
4. 平台差异：换行符/可执行权限/包管理器/工具链按本机环境
5. 建议先读一遍项目结构（README/task.json/docs），确认环境后再继续`;
                    await navigator.clipboard.writeText(text).catch(() => {});
                    setMigrateDone(null);
                  }}
                >
                  复制并关闭
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Windows 防火墙放行提示(设备互联端口,一次性) */}
        {firewallHint !== null && (
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 px-4 py-2.5 rounded-lg bg-surface-alt border border-border shadow-lg text-xs text-text-primary">
            <span>设备互联需要 Windows 防火墙放行端口 {firewallHint}——首次弹窗时请勾选「专用网络」并允许访问</span>
            <button className="text-text-secondary hover:text-text-primary shrink-0" onClick={() => setFirewallHint(null)}>✕</button>
          </div>
        )}
        {/* 接收端迁移确认弹窗(全应用层) */}
        <MigrationIncomingModal
          incoming={incomingTransfer}
          onClose={() => setIncomingTransfer(null)}
          onAccept={async (transferId, targetPath) => {
            const r = await window.electronAPI.migration.accept(transferId, targetPath);
            return r;
          }}
          onReject={async (transferId) => {
            await window.electronAPI.migration.reject(transferId);
            setIncomingTransfer(null);
          }}
        />
      </div>
    </ErrorBoundary>
  );
}
