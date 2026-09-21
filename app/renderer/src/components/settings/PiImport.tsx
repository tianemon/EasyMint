import { useEffect, useState } from "react";
import type { PiImportSummary } from "@shared/pi-config-import";
import { useSettingsStore } from "../../stores/settings-store";
import { confirmDialog } from "../ui/ConfirmDialog";
import { toast } from "../ui/Toast";

/**
 * pi 配置导入——共享流程 + 两个宿主（2026-09-21 重构，用户拍板布点）：
 *  - 引导页 Step 2：进入即零 IO 探测，命中渲染内嵌卡片（PiImportCard）
 *  - 设置页·通用页：手动触发检测（PiImportSection），命中走同一个明细弹窗
 * 旧的「供应商设置页顶部」挂载已摘除——导入内容含会话与项目，放供应商区语义偏窄。
 *
 * 检测与导入永不写入 pi 侧文件；导入是一次性复制（事务 + 备份，见主进程 pi-config-import）。
 */

/**
 * Step 2「就绪即自动离开」是否放行（纯函数——这段时序历史上改坏过多次，测试锚定）。
 *  - pi 检测未落定 → 不放（先记账，落定后重放）
 *  - 命中且未导入完成 → 不放：导入入口在本步，自动跳过去等于把选项收走；
 *    跳过只由用户点「下一步」或导入完成触发（用户拍板：不锁定）
 *  - 未命中 / 已导入 → 放行（未命中 = Step 2 保持纯过场原行为，2026-09-15 定位不变）
 */
export function envAutoAdvanceAllowed(piProbe: "pending" | "hit" | "miss", piImported: boolean): boolean {
  if (piProbe === "pending") return false;
  if (piProbe === "hit" && !piImported) return false;
  return true;
}

/** 确认弹窗正文：逐项说明会导入什么、跳过什么（message 走 whitespace-pre-line，\n 即换行） */
export function piImportConfirmMessage(plan: PiImportSummary): string {
  const lines = [`供应商 ${plan.providers} 个 · 会话 ${plan.sessions} 个 · 项目记录 ${plan.projects} 个`];
  const skipped = [
    plan.conflicts > 0 ? `${plan.conflicts} 项冲突` : "",
    plan.duplicates > 0 ? `${plan.duplicates} 个重复会话` : "",
    plan.invalidSessions > 0 ? `${plan.invalidSessions} 个无效会话` : "",
  ].filter(Boolean);
  if (skipped.length > 0) lines.push(`跳过：${skipped.join("、")}`);
  lines.push("EM 已有配置优先；项目级配置与扩展不导入");
  if (plan.oauth) lines.push("OAuth 账号复制后两份令牌独立，后续可能需要重新登录");
  return lines.join("\n");
}

/** 导入完成的结果摘要（toast 与卡片/小节的结果行共用一份口径） */
export function piImportResultText(s: PiImportSummary): string {
  return `已导入 ${s.providers} 个供应商、${s.sessions} 个会话、${s.projects} 个项目；跳过 ${s.conflicts} 项冲突（含 ${s.providerConflictSessions} 个供应商冲突会话）、${s.duplicates} 个重复会话、${s.invalidSessions} 个无效会话。`;
}

/**
 * 完整导入流程：预览 → 确认（明细弹窗）→ 事务导入 → 刷新设置 store。
 * 返回 null = 未找到可导入内容 / 用户取消（这两种情况**绝不写盘**）。
 */
export async function runPiImportFlow(sourceDir?: string): Promise<PiImportSummary | null> {
  const plan = await window.electronAPI.settings.piImport({ sourceDir });
  if (!plan.found) {
    toast("未找到可导入的 pi 配置或会话，可尝试「选择目录」指定 pi 的 agent 目录");
    return null;
  }
  const ok = await confirmDialog({
    title: "检测到 pi 配置",
    message: piImportConfirmMessage(plan),
    confirmText: "导入",
  });
  if (!ok) return null;
  const imported = await window.electronAPI.settings.piImport({ sourceDir: plan.sourceDir, apply: true });
  await useSettingsStore.getState().loadFromElectron();
  return imported;
}

/** 两个宿主共用的按钮执行器：choose 时先弹目录选择器，取消选择即中止。 */
async function runWithDirectory(choose: boolean): Promise<PiImportSummary | null> {
  if (choose) {
    const picked = await window.electronAPI.dialog.openDirectory();
    if (!picked) return null;
    return runPiImportFlow(picked);
  }
  return runPiImportFlow();
}

/** 按钮执行器的公共骨架：busy 态 + 错误兜底 + 结果摘要（两个宿主只有成功后的动作不同）。 */
function usePiImportRun(onSuccess?: (summary: PiImportSummary) => void) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const run = async (choose = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const imported = await runWithDirectory(choose);
      if (!imported) return;
      const text = piImportResultText(imported);
      setResult(text);
      toast(text);
      onSuccess?.(imported);
    } catch (error) {
      toast(`导入失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return { busy, result, run };
}

/** 引导页 Step 2 宿主：命中 pi 时由 OnboardingPage 渲染（宿主负责 probe 与自动跳转门控）。 */
export function PiImportCard({ onImported }: { onImported?: () => void }): JSX.Element {
  const { busy, result, run } = usePiImportRun(() => onImported?.());
  return (
    <div className="rounded-[var(--radius-lg)] bg-surface-alt p-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-text-primary font-medium">检测到本机 pi 配置</div>
          <p className="text-xs text-text-secondary mt-0.5">导入原生 pi 的供应商、会话与项目记录；跳过请点「下一步」</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            className="text-xs text-text-secondary em-hover-control transition-all"
            disabled={busy}
            onClick={() => void run(true)}
          >
            选择目录
          </button>
          <button
            type="button"
            className="btn-accent px-3 py-1.5 rounded-[var(--radius-lg)] text-xs font-medium"
            disabled={busy}
            onClick={() => void run()}
          >
            {busy ? "导入中…" : "导入 pi 配置"}
          </button>
        </div>
      </div>
      {result && <p className="text-xs text-text-secondary leading-relaxed">{result}</p>}
    </div>
  );
}

/**
 * 设置页·通用页宿主：手动触发检测（用户拍板属于手动触发，不随页面挂载自动弹）。
 * 未命中 → toast 一句；命中 → runPiImportFlow 的明细弹窗（即「弹窗提示检测到 pi 的配置」）。
 */
export function PiImportSection(): JSX.Element {
  const { busy, result, run } = usePiImportRun();
  // 升级合并同供应商多账号的遗留提示（一次性，只在升级备份里还有未选账号时有值）
  const [duplicateAccounts, setDuplicateAccounts] = useState(0);
  useEffect(() => {
    let active = true;
    window.electronAPI.settings.get()
      .then((s) => { if (active) setDuplicateAccounts(s.nativeConfigMigration?.duplicateConfigIds.length ?? 0); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  return (
    <section>
      <h3 className="text-sm font-medium text-text-secondary mb-2">原生 pi 配置</h3>
      <div className="bg-surface-alt rounded-[var(--radius-lg)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-xs font-medium text-text-secondary">从 pi 导入</h4>
            <p className="text-[length:var(--text-11)] text-text-secondary mt-0.5">
              检测本机原生 pi 的配置与会话，确认后导入（一次性复制，不改动 pi 目录）
            </p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <button
              type="button"
              className="px-3 py-1.5 rounded-[var(--radius-lg)] text-xs text-text-secondary em-hover-control transition-shadow"
              disabled={busy}
              onClick={() => void run(true)}
            >
              选择目录
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-[var(--radius-lg)] btn-accent text-xs font-medium"
              disabled={busy}
              onClick={() => void run()}
            >
              {busy ? "处理中…" : "检测"}
            </button>
          </div>
        </div>
        {duplicateAccounts > 0 && (
          <p className="text-[length:var(--text-11)] text-text-muted mt-2">
            升级已合并同一供应商的账号配置，{duplicateAccounts} 份未选账号保存在 ~/.easymint/config-backups 的升级备份中
          </p>
        )}
        {result && <p className="text-[length:var(--text-11)] text-text-secondary mt-2 leading-relaxed">{result}</p>}
      </div>
    </section>
  );
}
