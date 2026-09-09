import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";

/**
 * 上下文压缩确认弹层 — 自动触发(阈值)与手动(统计弹窗按钮)共用。
 * 选项(用户定稿排序): ① 立即压缩(系统自动总结) ④ 输入指令压缩
 * ③ 写交接提示词(不压缩,Mint 总结供复制,为开启新会话做准备)
 * ② 下次回复完触发(回复结束重新询问,同样流程)
 *
 * countdown(仅自动触发传入): 弹窗打开即倒计时并在选项①尾部展示剩余秒数,
 * 到 0 调 onExpire(父组件执行 compact + 置空弹窗)。手动触发不传,无倒计时。
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
  const [instructions, setInstructions] = useState("");
  // 配置在挂载时固化一次:ChatPanel 常因消息流重渲染、每次会新建 countdown 对象,
  // 直接依赖 prop 会把计时反复重置;弹窗每次打开都是全新挂载,卸载即清定时器。
  const [countdownConfig] = useState(countdown);
  const [remaining, setRemaining] = useState(() => (countdown ? countdown.total : 0));

  useEffect(() => {
    if (!countdownConfig) return;
    let left = countdownConfig.total;
    const timer = window.setInterval(() => {
      left -= 1;
      setRemaining(left);
      if (left <= 0) {
        window.clearInterval(timer);
        countdownConfig.onExpire();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [countdownConfig]);

  return (
    <Modal tier="modal" overlayClassName="bg-black/30" onClose={onClose}>
      <div className="bg-surface border border-border rounded-xl p-5 max-w-md w-full shadow-2xl mx-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium text-text-primary">{title}</div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary shrink-0">
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M3 3l8 8M11 3L3 11"/></svg>
          </button>
        </div>
        <p className="text-xs text-text-secondary mb-3">压缩会整理对话上下文、释放空间；写交接提示词则不压缩，由 Mint 总结供你复制。</p>
        <div className="space-y-1">
          <button
            type="button"
            onClick={onImmediate}
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-hover text-xs text-text-primary transition-colors"
          >
            <span className="flex items-center justify-between gap-3">
              <span>是，立即压缩（系统自动总结）</span>
              {countdownConfig && remaining > 0 && (
                <span className="text-text-secondary tabular-nums shrink-0">{remaining} 秒后自动压缩</span>
              )}
            </span>
          </button>
          <button
            type="button"
            onClick={onWriteHandoff}
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-hover text-xs text-text-primary transition-colors"
          >
            否，开启新会话，帮我写交接提示词
          </button>
          <button
            type="button"
            onClick={onDefer}
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-hover text-xs text-text-primary transition-colors"
          >
            否，Mint 下次回复完触发
          </button>
        </div>
        {/* 分隔线 + 输入指令区 */}
        <div className="border-t border-border/60 my-3" />
        <div className="flex items-center gap-2">
          <input
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onWithInstructions(instructions.trim()); }}
            placeholder="输入压缩指令，例如保留某个上下文信息…"
            autoFocus
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-surface-alt text-xs text-text-primary outline-none placeholder:text-text-muted"
          />
          <button
            type="button"
            onClick={() => onWithInstructions(instructions.trim())}
            className="px-3 py-1.5 rounded-lg btn-accent text-xs font-medium shrink-0"
          >
            是，输入指令
          </button>
        </div>
      </div>
    </Modal>
  );
}
