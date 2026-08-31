import { useState } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { useThemeStore } from "../../stores/theme-store";
import { GlowGroupManager } from "./GlowGroupManager";

/** 界面设置:聊天/界面字体缩放 + 状态指示光效 */
export function AppearanceTab(): JSX.Element {
  const chatFontScale = useSettingsStore((s) => s.chatFontScale);
  const setChatFontScale = useSettingsStore((s) => s.setChatFontScale);
  const uiFontScale = useSettingsStore((s) => s.uiFontScale);
  const setUiFontScale = useSettingsStore((s) => s.setUiFontScale);
  // 输入卡片光效配置
  const glowEffect = useSettingsStore((s) => s.glowEffect);
  const setGlowEffect = useSettingsStore((s) => s.setGlowEffect);
  const glowColorMode = useSettingsStore((s) => s.glowColorMode);
  const setGlowColorMode = useSettingsStore((s) => s.setGlowColorMode);
  const glowColorLight = useSettingsStore((s) => s.glowColorLight);
  const setGlowColorLight = useSettingsStore((s) => s.setGlowColorLight);
  const glowColorDark = useSettingsStore((s) => s.glowColorDark);
  const setGlowColorDark = useSettingsStore((s) => s.setGlowColorDark);
  const glowGroupsLight = useSettingsStore((s) => s.glowGroupsLight);
  const setGlowGroupsLight = useSettingsStore((s) => s.setGlowGroupsLight);
  const glowGroupsDark = useSettingsStore((s) => s.glowGroupsDark);
  const setGlowGroupsDark = useSettingsStore((s) => s.setGlowGroupsDark);
  const activeGlowGroupLight = useSettingsStore((s) => s.activeGlowGroupLight);
  const setActiveGlowGroupLight = useSettingsStore((s) => s.setActiveGlowGroupLight);
  const activeGlowGroupDark = useSettingsStore((s) => s.activeGlowGroupDark);
  const setActiveGlowGroupDark = useSettingsStore((s) => s.setActiveGlowGroupDark);
  // Mint 状态文本配置(独立于光效色)
  const statusTextStyle = useSettingsStore((s) => s.statusTextStyle);
  const setStatusTextStyle = useSettingsStore((s) => s.setStatusTextStyle);
  const statusColorLight = useSettingsStore((s) => s.statusColorLight);
  const setStatusColorLight = useSettingsStore((s) => s.setStatusColorLight);
  const statusColorDark = useSettingsStore((s) => s.statusColorDark);
  const setStatusColorDark = useSettingsStore((s) => s.setStatusColorDark);
  const statusTextGroupsLight = useSettingsStore((s) => s.statusTextGroupsLight);
  const setStatusTextGroupsLight = useSettingsStore((s) => s.setStatusTextGroupsLight);
  const statusTextGroupsDark = useSettingsStore((s) => s.statusTextGroupsDark);
  const setStatusTextGroupsDark = useSettingsStore((s) => s.setStatusTextGroupsDark);
  const activeStatusGroupLight = useSettingsStore((s) => s.activeStatusGroupLight);
  const setActiveStatusGroupLight = useSettingsStore((s) => s.setActiveStatusGroupLight);
  const activeStatusGroupDark = useSettingsStore((s) => s.activeStatusGroupDark);
  const setActiveStatusGroupDark = useSettingsStore((s) => s.setActiveStatusGroupDark);

  // 亮/暗编辑模式切换(两套独立配置):打开设置时按当前主题自动选中对应模式
  const isDark = useThemeStore((s) => s.effective) === "dark";
  const [editMode, setEditMode] = useState<"light" | "dark">(isDark ? "dark" : "light");

  // 当前编辑模式的颜色值/setter
  const glowGroups = editMode === "light" ? glowGroupsLight : glowGroupsDark;
  const setGlowGroups = editMode === "light" ? setGlowGroupsLight : setGlowGroupsDark;
  const activeGlowGroup = editMode === "light" ? activeGlowGroupLight : activeGlowGroupDark;
  const setActiveGlowGroup = editMode === "light" ? setActiveGlowGroupLight : setActiveGlowGroupDark;
  const glowColor = editMode === "light" ? glowColorLight : glowColorDark;
  const setGlowColor = editMode === "light" ? setGlowColorLight : setGlowColorDark;
  const statusGroups = editMode === "light" ? statusTextGroupsLight : statusTextGroupsDark;
  const setStatusGroups = editMode === "light" ? setStatusTextGroupsLight : setStatusTextGroupsDark;
  const activeStatusGroup = editMode === "light" ? activeStatusGroupLight : activeStatusGroupDark;
  const setActiveStatusGroup = editMode === "light" ? setActiveStatusGroupLight : setActiveStatusGroupDark;
  const statusColor = editMode === "light" ? statusColorLight : statusColorDark;
  const setStatusColor = editMode === "light" ? setStatusColorLight : setStatusColorDark;

  const GLOW_PRESETS: Array<{ id: "orbit" | "slide" | "breathe" | "off"; label: string; desc: string }> = [
    { id: "orbit", label: "环绕流光", desc: "沿边框旋转流动" },
    { id: "slide", label: "顶部滑动", desc: "上边框左右滑动" },
    { id: "breathe", label: "呼吸灯", desc: "光晕向外发散" },
    { id: "off", label: "关闭", desc: "不显示光效" },
  ];

  return (
    <div className="space-y-5">
      {/* 阅读字体:动态内容区(聊天/编辑器/Shell 输出等)百分比缩放 */}
      <section>
        <h3 className="text-sm font-medium text-text-secondary mb-2">阅读字体</h3>
        <div className="bg-surface-alt rounded-lg border border-border px-4 py-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-text-primary">字号缩放</span>
            <span className="text-xs text-text-secondary tabular-nums">{Math.round(chatFontScale * 100)}%</span>
          </div>
          <input
            type="range"
            min="0.9"
            max="1.3"
            step="0.05"
            value={chatFontScale}
            onChange={(e) => setChatFontScale(Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[length:var(--text-3xs)] text-text-muted mt-0.5">
            <span>小</span>
            <span>默认(100%)</span>
            <span>大</span>
          </div>
          <p className="text-[length:var(--text-2xs)] text-text-secondary mt-1">聊天正文、代码块、代码编辑器、输出日志等阅读内容按百分比整体缩放（界面骨架文字由下方「界面字体」控制）。</p>
        </div>
      </section>

      {/* 界面字体:百分比缩放统一控制 UI 骨架 */}
      <section>
        <h3 className="text-sm font-medium text-text-secondary mb-2">界面字体</h3>
        <div className="bg-surface-alt rounded-lg border border-border px-4 py-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-text-primary">字号缩放</span>
            <span className="text-xs text-text-secondary tabular-nums">{Math.round(uiFontScale * 100)}%</span>
          </div>
          <input
            type="range"
            min="0.9"
            max="1.3"
            step="0.05"
            value={uiFontScale}
            onChange={(e) => setUiFontScale(Number(e.target.value))}
            className="w-full accent-accent"
          />
          <div className="flex justify-between text-[length:var(--text-3xs)] text-text-muted mt-0.5">
            <span>小</span>
            <span>默认(100%)</span>
            <span>大</span>
          </div>
          <p className="text-[length:var(--text-2xs)] text-text-secondary mt-1">界面文字（文件列表、侧边栏、按钮、弹窗等）按百分比缩放；阅读内容字号由上方「阅读字体」控制</p>
        </div>
      </section>

      {/* 状态指示光效 */}
      <section>
        <h3 className="text-sm font-medium text-text-secondary mb-2">状态指示光效</h3>
        <div className="bg-surface-alt rounded-lg border border-border px-4 py-3 space-y-4">
          {/* 亮/暗编辑模式切换 */}
          <div className="inline-flex rounded-lg overflow-hidden border border-border bg-surface">
            {(["light", "dark"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setEditMode(m)}
                className={`px-4 py-1.5 text-xs transition-colors ${
                  editMode === m ? "bg-accent-soft text-accent font-medium" : "text-text-secondary hover:bg-surface-hover"
                }`}
              >
                {m === "light" ? "亮色" : "暗色"}
              </button>
            ))}
          </div>

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
                  <span className="text-[length:var(--text-2xs)] text-text-muted">{p.desc}</span>
                </button>
              ))}
            </div>
            {/* 光效颜色:单色/多色模式切换(当前编辑模式);参数固定(粗细/速度/拖尾为组件常量) */}
            {glowEffect !== "off" && (
              <div className="mt-2 space-y-2">
                <div className="inline-flex rounded-lg overflow-hidden border border-border bg-surface">
                  {(["solid", "multi"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setGlowColorMode(m)}
                      className={`px-3 py-1 text-xs transition-colors ${
                        glowColorMode === m ? "bg-accent-soft text-accent font-medium" : "text-text-secondary hover:bg-surface-hover"
                      }`}
                    >
                      {m === "solid" ? "单色" : "多色"}
                    </button>
                  ))}
                </div>
                {glowColorMode === "solid" ? (
                  // 不用 label 包裹:label 的关联触发会让点击文字/空白区域也打开取色器(触发区域大于视觉按钮)
                  <div className="flex items-center gap-2 text-xs text-text-secondary">
                    <span>光效颜色</span>
                    <input type="color" value={glowColor} onChange={(e) => setGlowColor(e.target.value)} className="w-7 h-7 rounded cursor-pointer border border-border bg-transparent" />
                  </div>
                ) : (
                  <GlowGroupManager groups={glowGroups} activeId={activeGlowGroup} onChangeGroups={setGlowGroups} onChangeActive={setActiveGlowGroup} />
                )}
              </div>
            )}
          </div>

          {/* Mint 状态文本 */}
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
            {/* 单色模式:颜色选择(当前编辑模式);不用 label 包裹(触发区域问题同上) */}
            {statusTextStyle === "solid" && (
              <div className="flex items-center gap-2 text-xs text-text-secondary mt-2">
                <span>文本颜色</span>
                <input type="color" value={statusColor} onChange={(e) => setStatusColor(e.target.value)} className="w-7 h-7 rounded cursor-pointer border border-border bg-transparent" />
              </div>
            )}
            {/* 流光模式:分组管理(内置「默认」不可删 + 自定义 ≤4) */}
            {statusTextStyle === "shimmer" && (
              <div className="mt-2">
                <GlowGroupManager groups={statusGroups} activeId={activeStatusGroup} onChangeGroups={setStatusGroups} onChangeActive={setActiveStatusGroup} />
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
