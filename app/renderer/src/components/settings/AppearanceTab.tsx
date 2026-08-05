import { useSettingsStore } from "../../stores/settings-store";

/** 界面设置:聊天字体分级 */
export function AppearanceTab(): JSX.Element {
  const chatFontLevel = useSettingsStore((s) => s.chatFontLevel);
  const setChatFontLevel = useSettingsStore((s) => s.setChatFontLevel);

  return (
    <div className="space-y-5">
      {/* 聊天字体:分级整体控制 */}
      <section>
        <h3 className="text-sm font-medium text-text-secondary mb-2">聊天字体</h3>
        <div className="bg-surface-alt rounded-lg border border-border px-4 py-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-text-primary">字体大小</span>
            <span className="text-xs text-text-secondary tabular-nums">{chatFontLevel}/6 级</span>
          </div>
          <input
            type="range"
            min="1"
            max="6"
            step="1"
            value={chatFontLevel}
            onChange={(e) => setChatFontLevel(Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[9px] text-text-muted mt-0.5">
            <span>小</span>
            <span>默认(3)</span>
            <span>大</span>
          </div>
          <p className="text-[10px] text-text-secondary mt-1">整体控制聊天界面的字体大小——会话列表、消息气泡、思考与工具调用会按层级同步缩放（默认第 3 级，可减小 2 号、放大 3 号）。</p>
        </div>
      </section>
    </div>
  );
}
