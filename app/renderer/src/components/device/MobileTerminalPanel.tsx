import { uiText, useUiLocale } from "../../lib/i18n";
import { useEffect, useRef } from "react";
import { MobileTerminalSection } from "./MobileTerminalSection";

/**
 * 连接手机悬浮浮层(内嵌 absolute 覆盖主界面):
 * - 扫码配对(生成二维码,手机 App 扫)
 * - 待确认的配对请求(校验码比对)
 * - 已配对手机列表(在线状态 + 解除配对)
 *
 * 与「项目迁移」面板是两条独立链路:那里是电脑↔电脑迁移项目(mDNS 发现 + WS 配对 + 分块传输),
 * 这里是电脑↔手机(手机只显示 PC 实时数据、发指令)。故各自一个工具箱入口与浮层。
 */

interface MobileTerminalPanelProps {
  open: boolean;
  onClose: () => void;
}

export function MobileTerminalPanel({ open, onClose }: MobileTerminalPanelProps): JSX.Element | null {
  useUiLocale();
  const ref = useRef<HTMLDivElement>(null);

  // 点击遮罩/Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    // 层级用 z-dialog(与历史输入抽屉同级):z-float 时聊天页的历史输入按钮会盖在抽屉上方
    <div className="no-drag fixed inset-0 z-dialog flex items-start justify-end bg-black/40" onMouseDown={onClose}>
      <div
        ref={ref}
        className="em-glass w-[340px] h-full flex flex-col rounded-l-[var(--radius-lg)] shadow-2xl animate-[drawer-in_200ms_ease-out] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span className="text-sm font-medium text-text-primary">{uiText("ui.MobileTerminalPanel.connectPhone")}</span>
          <button type="button" className="text-text-secondary hover:text-text-primary transition-colors text-sm px-1" onClick={onClose}>✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pt-1 pb-6 space-y-4 flex flex-col">
          <MobileTerminalSection />
        </div>
      </div>
    </div>
  );
}
