import { useState, type DragEvent } from "react";
import { useSettingsStore } from "../../stores/settings-store";

/** 界面设置:聊天字体分级 + 状态指示光效 */
export function AppearanceTab(): JSX.Element {
  const chatFontLevel = useSettingsStore((s) => s.chatFontLevel);
  const setChatFontLevel = useSettingsStore((s) => s.setChatFontLevel);
  const glowEffect = useSettingsStore((s) => s.glowEffect);
  const setGlowEffect = useSettingsStore((s) => s.setGlowEffect);
  const glowColorLight = useSettingsStore((s) => s.glowColorLight);
  const setGlowColorLight = useSettingsStore((s) => s.setGlowColorLight);
  const glowColorDark = useSettingsStore((s) => s.glowColorDark);
  const setGlowColorDark = useSettingsStore((s) => s.setGlowColorDark);
  const statusTextStyle = useSettingsStore((s) => s.statusTextStyle);
  const setStatusTextStyle = useSettingsStore((s) => s.setStatusTextStyle);
  const statusTextColors = useSettingsStore((s) => s.statusTextColors);
  const setStatusTextColors = useSettingsStore((s) => s.setStatusTextColors);

  // 色彩组合拖拽排序(原生 HTML5 drag)
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const handleDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const next = [...statusTextColors];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved!);
    setStatusTextColors(next);
    setDragIdx(null);
  };

  const GLOW_PRESETS: Array<{ id: "orbit" | "slide" | "breathe" | "off"; label: string; desc: string }> = [
    { id: "orbit", label: "环绕流光", desc: "沿边框旋转流动" },
    { id: "slide", label: "顶部滑动", desc: "上边框左右滑动拖尾" },
    { id: "breathe", label: "呼吸灯", desc: "整圈边框明暗起伏" },
    { id: "off", label: "关闭", desc: "不显示光效" },
  ];

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

      {/* 状态指示光效 */}
      <section>
        <h3 className="text-sm font-medium text-text-secondary mb-2">状态指示光效</h3>
        <div className="bg-surface-alt rounded-lg border border-border px-4 py-3 space-y-4">
          {/* 输入卡片光效预设 */}
          <div>
            <span className="text-xs text-text-primary block mb-2">输入卡片光效</span>
            <div className="grid grid-cols-2 gap-2">
              {GLOW_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setGlowEffect(p.id)}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                    glowEffect === p.id
                      ? "border-accent bg-accent-soft text-text-primary"
                      : "border-border bg-surface hover:bg-surface-hover text-text-secondary"
                  }`}
                >
                  <span className="text-xs font-medium block">{p.label}</span>
                  <span className="text-[10px] text-text-muted">{p.desc}</span>
                </button>
              ))}
            </div>
          </div>
          {/* 光效颜色:亮/暗模式分别配置 */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <span>亮色模式</span>
              <input type="color" value={glowColorLight} onChange={(e) => setGlowColorLight(e.target.value)} className="w-7 h-7 rounded cursor-pointer border border-border bg-transparent" />
            </label>
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <span>暗色模式</span>
              <input type="color" value={glowColorDark} onChange={(e) => setGlowColorDark(e.target.value)} className="w-7 h-7 rounded cursor-pointer border border-border bg-transparent" />
            </label>
          </div>
          {/* Mint 状态文本样式 */}
          <div>
            <span className="text-xs text-text-primary block mb-2">Mint 状态文本</span>
            <div className="inline-flex rounded-lg overflow-hidden border border-border bg-surface">
              {(["solid", "shimmer"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusTextStyle(s)}
                  className={`px-4 py-1.5 text-xs transition-colors ${
                    statusTextStyle === s ? "bg-accent-soft text-accent font-medium" : "text-text-secondary hover:bg-surface-hover"
                  }`}
                >
                  {s === "solid" ? "单色" : "流光"}
                </button>
              ))}
            </div>
          </div>
          {/* 流光色彩组合(拖拽排序 + 添加) */}
          {statusTextStyle === "shimmer" && (
            <div>
              <span className="text-xs text-text-primary block mb-2">流光色彩(拖拽排序)</span>
              <div className="flex flex-wrap items-center gap-2">
                {statusTextColors.map((c, i) => (
                  <div
                    key={`${c}-${i}`}
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragOver={(e: DragEvent) => e.preventDefault()}
                    onDrop={() => handleDrop(i)}
                    className={`group relative w-8 h-8 rounded-lg cursor-grab border border-border shadow-sm transition-transform ${
                      dragIdx === i ? "opacity-50 scale-90" : "hover:scale-105"
                    }`}
                    style={{ background: c }}
                    title="拖拽排序"
                  >
                    <button
                      type="button"
                      onClick={() => setStatusTextColors(statusTextColors.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-surface border border-border text-text-muted hover:text-danger text-[9px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="移除"
                    >✕</button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setStatusTextColors([...statusTextColors, "#22c55e"])}
                  className="w-8 h-8 rounded-lg border border-dashed border-border text-text-muted hover:text-text-secondary hover:border-accent text-lg flex items-center justify-center transition-colors"
                  title="添加颜色"
                >+</button>
              </div>
              <p className="text-[10px] text-text-secondary mt-1">拖拽色块调整流光渐变顺序，悬停色块可移除。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
