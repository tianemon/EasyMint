import { useEffect, useState } from "react";
import type { PiImportSummary } from "@shared/pi-config-import";
import { useSettingsStore } from "../../stores/settings-store";
import { confirmDialog } from "../ui/ConfirmDialog";
import { toast } from "../ui/Toast";

/** Shared onboarding/settings entry; detection never writes imported files. */
export function PiImport() {
  const [summary, setSummary] = useState<PiImportSummary | null>(null);
  const [duplicateAccounts, setDuplicateAccounts] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  useEffect(() => {
    let active = true;
    window.electronAPI.settings.get().then(settings => { if (active) setDuplicateAccounts(settings.nativeConfigMigration?.duplicateConfigIds.length ?? 0); }).catch(() => {});
    // 挂载只做存在性探测（不读任何会话内容）：完整预览会全量解析会话，放到点击后
    window.electronAPI.settings.piImport({ probe: true }).then(value => { if (active) setSummary(value); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const run = async (choose = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const sourceDir = choose ? await window.electronAPI.dialog.openDirectory() : summary?.sourceDir;
      if (choose && !sourceDir) return;
      const plan = await window.electronAPI.settings.piImport({ sourceDir: sourceDir ?? undefined });
      setSummary(plan);
      if (!plan.found) { toast("未找到可导入的 pi 配置或会话，请选择 pi 的 agent 目录"); return; }
      const ok = await confirmDialog({
        title: "从 pi 导入",
        message: `将导入 ${plan.providers} 个供应商、${plan.sessions} 个会话和 ${plan.projects} 个项目。已有配置优先，${plan.conflicts} 项冲突将跳过。项目配置和扩展不会导入。${plan.oauth ? " OAuth 账号后续可能需要重新登录。" : ""}`,
        confirmText: "导入",
      });
      if (!ok) return;
      const imported = await window.electronAPI.settings.piImport({ sourceDir: plan.sourceDir, apply: true });
      await useSettingsStore.getState().loadFromElectron();
      const text = `已导入 ${imported.providers} 个供应商、${imported.sessions} 个会话、${imported.projects} 个项目；跳过 ${imported.conflicts} 项冲突（含 ${imported.providerConflictSessions} 个供应商冲突会话）、${imported.duplicates} 个重复会话、${imported.invalidSessions} 个无效会话。`;
      setResult(text); toast(text);
    } catch (error) { toast(`导入失败：${(error as Error).message}`); }
    finally { setBusy(false); }
  };
  return <div className="rounded-[var(--radius-lg)] bg-surface-alt p-3 space-y-2">
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-text-secondary">{summary?.found ? "检测到本机 pi 配置或会话" : "已有 pi 配置？"}</span>
      <div className="flex gap-2">
        <button className="text-xs text-text-secondary" disabled={busy} onClick={() => void run(true)}>选择目录</button>
        <button className="text-xs text-accent" disabled={busy} onClick={() => void run()}>{busy ? "处理中…" : "从 pi 导入"}</button>
      </div>
    </div>
    {duplicateAccounts > 0 && <p className="text-xs text-text-secondary">升级已合并同一供应商的账号配置，{duplicateAccounts} 份未选账号保存在 ~/.easymint/config-backups 的升级备份中。</p>}
    {result && <p className="text-xs text-text-secondary">{result}</p>}
  </div>;
}
