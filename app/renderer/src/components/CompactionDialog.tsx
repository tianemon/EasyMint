import { uiText, useUiLocale } from "../lib/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./ui/Modal";

/**
 * 上下文压缩确认弹层 — 自动触发(阈值)与手动(统计弹窗按钮)共用。
 * 选项(用户定稿排序): ① 立即压缩(系统自动总结) ④ 输入指令压缩
 * ③ 写交接提示词(不压缩,Mint 总结供复制,为开启新会话做准备)
 * ② 下次回复完触发(回复结束重新询问,同样流程)
 *
 * countdown(仅自动触发传入): 弹窗打开即倒计时并在选项①尾部展示剩余秒数,
 * 到 0 调 onExpire(父组件执行 compact + 置空弹窗)。手动触发不传,无倒计时。
 *
 * 倒计时为「用户输入让位」(方案②): 用户一旦在下方指令输入框敲入非空内容,即视为已介入,
 * 立即冻结倒计时——不再走 0、不再触发 onExpire,弹窗保持打开等用户显式选择。
 * 解决「用户正在写指令时被到点自动压缩抢跑」:onExpire 会直接关弹窗并开始压缩,
 * 已输入的指令文本连同弹窗一起消失,用户来不及点「是,输入指令」。
 * 冻结是单向的:清空输入也不恢复倒计时(避免「删空瞬间被自动压缩」);想继续自动压缩就重开弹窗。
 * 用户点任一选项/提交指令/关闭弹窗 → 弹窗卸载 → effect cleanup 清除定时器,不残留。
 */
export function CompactionDialog({
  title,
  countdown,
  onImmediate,
  onWithInstructions,
  onWriteHandoff,
  onDefer,
  onClose,
}: {
  title: string;
  countdown?: { total: number; onExpire: () => void };
  onImmediate: () => void;
  onWithInstructions: (instructions: string) => void;
  onWriteHandoff: () => void;
  onDefer: () => void;
  onClose: () => void;
}): JSX.Element {
  useUiLocale();
  const [instructions, setInstructions] = useState("");
  // 配置在挂载时固化一次:ChatPanel 常因消息流重渲染、每次会新建 countdown 对象,
  // 直接依赖 prop 会把计时反复重置;弹窗每次打开都是全新挂载,卸载即清定时器。
  const [countdownConfig] = useState(countdown);
  const [remaining, setRemaining] = useState(() => (countdown ? countdown.total : 0));
  // 倒计时是否已被用户输入冻结(方案②):冻结后不展示秒数、也不再触发 onExpire
  const [frozen, setFrozen] = useState(false);
  const timerRef = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!countdownConfig) return;
    let left = countdownConfig.total;
    timerRef.current = window.setInterval(() => {
      left -= 1;
      setRemaining(left);
      if (left <= 0) {
        stopTimer();
        countdownConfig.onExpire();
      }
    }, 1000);
    return stopTimer;
  }, [countdownConfig, stopTimer]);

  // 用户开始输入指令 → 立即冻结倒计时:有指令内容就不该被自动压缩抢跑(方案②)。
  // 放在输入这一侧而非「到 0 时再判断」,是为了同时修掉界面上的假承诺——
  // 否则打字期间数字仍在一路倒数「N 秒后自动压缩」,与「不会自动压缩」矛盾,反而催用户停手。
  useEffect(() => {
    if (!countdownConfig || frozen) return;
    if (!instructions.trim()) return;
    stopTimer();
    setFrozen(true);
  }, [instructions, countdownConfig, frozen, stopTimer]);

  return (
    <Modal tier="modal" overlayClassName="bg-black/40" onClose={onClose}>
      <div className="bg-[var(--modal-fill)] rounded-[var(--radius-lg)] p-5 max-w-md w-full shadow-2xl mx-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium text-text-primary">{title}</div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary shrink-0">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M3 3l8 8M11 3L3 11"/></svg>
          </button>
        </div>
        <p className="text-xs text-text-secondary mb-3">{uiText("ui.CompactionDialog.compactionSummarizesTheConversationToFreeSpace")}</p>
        <div className="space-y-1">
          <button
            type="button"
            onClick={onImmediate}
            className="w-full text-left px-3 py-2 rounded-[var(--radius-lg)] hover:bg-surface-hover text-xs text-text-primary transition-colors"
          >
            <span className="flex items-center justify-between gap-3">
              <span>{uiText("ui.CompactionDialog.yesCompactNowAutomaticSummary")}</span>
              {countdownConfig && !frozen && remaining > 0 && (
                <span className="text-text-secondary tabular-nums shrink-0">{uiText("compaction.countdown", { count: remaining })}</span>
              )}
              {countdownConfig && frozen && (
                <span className="text-text-muted shrink-0">{uiText("ui.CompactionDialog.automaticCompactionPaused")}</span>
              )}
            </span>
          </button>
          <button
            type="button"
            onClick={onWriteHandoff}
            className="w-full text-left px-3 py-2 rounded-[var(--radius-lg)] hover:bg-surface-hover text-xs text-text-primary transition-colors"
          >
            {uiText("ui.CompactionDialog.noStartANewSessionAndWrite")}</button>
          <button
            type="button"
            onClick={onDefer}
            className="w-full text-left px-3 py-2 rounded-[var(--radius-lg)] hover:bg-surface-hover text-xs text-text-primary transition-colors"
          >
            {uiText("ui.CompactionDialog.noCompactAfterMintSNextResponse")}</button>
        </div>
        {/* 分隔线 + 输入指令区 */}
        <div className="border-t border-border/60 my-3" />
        {/* 说清指令的效力边界：SDK 的摘要提示词要求固定段结构，指令只是追加在末尾的附加关注点
            （保留/强调某类信息），改不了结构——不写这句会有「我提了要求却没生效」的预期落差 */}
        <p className="text-[length:var(--text-11)] text-text-muted mb-2">
          {uiText("ui.CompactionDialog.instructionsHighlightWhatToRetainTheEngine")}</p>
        <div className="flex items-center gap-2">
          <input
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onWithInstructions(instructions.trim()); }}
            placeholder={uiText("ui.CompactionDialog.eGRetainDatabaseSchemaChanges")}
            autoFocus
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-[var(--radius-lg)] bg-surface-alt text-xs text-text-primary outline-none placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={() => onWithInstructions(instructions.trim())}
            className="px-3 py-1.5 rounded-[var(--radius-lg)] btn-accent text-xs font-medium shrink-0"
          >
            {uiText("ui.CompactionDialog.yesWithInstructions")}</button>
        </div>
      </div>
    </Modal>
  );
}
