import { newGlowGroupId, type GlowColorGroup } from "../../stores/settings-store";
import { ColorFlowEditor } from "./ColorFlowEditor";

interface GlowGroupManagerProps {
  groups: GlowColorGroup[];
  activeId: string;
  onChangeGroups: (groups: GlowColorGroup[]) => void;
  onChangeActive: (id: string) => void;
  /** 自定义组上限(内置「默认」不计入) */
  maxCustom?: number;
}

/**
 * 流光分组管理器:组标签行(内置「默认」不可删) + 添加自定义组(≤maxCustom) + 当前组色彩编辑。
 * 输入卡片光效与 Mint 状态流光共用。
 */
export function GlowGroupManager({ groups, activeId, onChangeGroups, onChangeActive, maxCustom = 4 }: GlowGroupManagerProps): JSX.Element {
  const activeGroup = groups.find((g) => g.id === activeId) ?? groups[0];
  const customCount = groups.filter((g) => !g.isBuiltin).length;

  const addGroup = (): void => {
    if (customCount >= maxCustom) return;
    const id = newGlowGroupId();
    // 新组默认空色彩,用户自行添加
    onChangeGroups([...groups, { id, name: `自定义 ${customCount + 1}`, colors: [] }]);
    onChangeActive(id);
  };
  const removeGroup = (gid: string): void => {
    if (groups.length <= 1) return;
    const target = groups.find((g) => g.id === gid);
    if (target?.isBuiltin) return;
    const next = groups.filter((g) => g.id !== gid);
    onChangeGroups(next);
    if (activeId === gid) onChangeActive(next[0]?.id ?? "");
  };
  const updateGroup = (gid: string, colors: string[]): void => {
    onChangeGroups(groups.map((g) => (g.id === gid ? { ...g, colors } : g)));
  };

  return (
    <>
      {/* 组标签行:点击启用,自定义组悬停删除,添加新组 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {groups.map((g) => (
          <span
            key={g.id}
            onClick={() => onChangeActive(g.id)}
            className={`group/g relative px-1.5 py-0.5 rounded-md text-[11px] cursor-pointer border transition-colors ${
              activeGroup?.id === g.id
                ? "border-accent bg-accent-soft text-accent font-medium"
                : "border-border bg-surface text-text-secondary hover:bg-surface-hover"
            }`}
            title={`点击启用「${g.name}」`}
          >
            {g.name}
            {!g.isBuiltin && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeGroup(g.id); }}
                className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-surface border border-border text-text-muted hover:text-danger text-[8px] flex items-center justify-center opacity-0 group-hover/g:opacity-100 transition-opacity"
                title="删除该组"
              >✕</button>
            )}
          </span>
        ))}
        {customCount < maxCustom && (
          <button
            type="button"
            onClick={addGroup}
            className="px-2 py-0.5 rounded-md border border-dashed border-border text-text-muted hover:text-text-secondary hover:border-accent text-[11px] transition-colors"
            title="添加新组"
          >+ 添加</button>
        )}
      </div>
      {/* 当前组色彩:内置「默认」只读展示,自定义可编辑 */}
      {activeGroup && (
        <div className="mt-1.5">
          <ColorFlowEditor
            colors={activeGroup.colors}
            onChange={(cs) => updateGroup(activeGroup.id, cs)}
            readonly={activeGroup.isBuiltin}
          />
        </div>
      )}
    </>
  );
}
