import { useEffect, useRef, useState, type DragEvent } from "react";
import { ColorPickerPanel, type ColorPickerAnchor } from "../ColorPicker";

interface ColorFlowEditorProps {
  /** 当前色彩组合(有序) */
  colors: string[];
  /** 变更回调(增删改排) */
  onChange: (colors: string[]) => void;
  /** 添加新色时的默认色(添加后可点击改色) */
  addColor?: string;
  /** 只读模式(内置预设:不可改色/拖拽/移除/添加) */
  readonly?: boolean;
}

/**
 * 色彩组合编辑器:点击色块弹出自绘取色面板改色 + 拖拽排序 + 悬停移除 + 添加。
 * 光效色彩组合与状态流光组合共用;readonly 时仅展示色块(内置预设)。
 */
export function ColorFlowEditor({ colors, onChange, addColor = "#22c55e", readonly = false }: ColorFlowEditorProps): JSX.Element {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // 取色状态:被点色块 index + 点击瞬间的视口矩形(面板 fixed 锚定此矩形,渲染后测超出翻)
  const [picking, setPicking] = useState<{ idx: number; rect: ColorPickerAnchor } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // 拖拽中隐藏过的按钮(组件卸载兜底恢复,防 inline opacity 残留)
  const hiddenBtnsRef = useRef<HTMLElement[]>([]);
  useEffect(() => () => {
    hiddenBtnsRef.current.forEach((b) => { b.style.opacity = ""; });
    hiddenBtnsRef.current = [];
  }, []);

  /** 面板打开期间该位颜色被移除(如拖拽排序) → 关闭面板防越界写 */
  useEffect(() => {
    if (picking && colors[picking.idx] === undefined) setPicking(null);
  }, [colors, picking]);

  /** 复制色块:克隆当前色块插入其右侧(duplicate);结构性变更 → 收起取色面板(否则 picking.idx 指向的颜色随插入右移而错位) */
  const handleDuplicate = (idx: number): void => {
    setPicking(null);
    const next = [...colors];
    next.splice(idx + 1, 0, colors[idx]!);
    onChange(next);
  };

  /** 取色面板选色写回被点色块;实时预览(拖选)/点击色板即应用 */
  const handlePickColor = (hex: string): void => {
    if (!picking) return;
    const next = [...colors];
    if (next[picking.idx] === undefined) return;
    next[picking.idx] = hex;
    onChange(next);
  };

  const handleDrop = (targetIdx: number): void => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const next = [...colors];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved!);
    onChange(next);
    setDragIdx(null);
  };

  // 容器兜底 drop:拖到色块间隙/空白处时,按 drop 点最近的色块确定排序目标
  const handleContainerDrop = (e: DragEvent): void => {
    if (dragIdx === null) return;
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const items = el.querySelectorAll<HTMLElement>("[data-cidx]");
    let best = dragIdx;
    let bestDist = Infinity;
    items.forEach((it) => {
      const idx = Number(it.dataset.cidx);
      const r = it.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < bestDist) { bestDist = d; best = idx; }
    });
    handleDrop(best);
  };

  // 拖拽开始:声明 move(无 copy 徽标"+");与取色互斥:拖拽即收起面板,避免追着被移动色块。
  // 拖影 = 源色块自身截图(跟随鼠标),快照前隐藏 hover 按钮——拖影只有纯色块,源色块按钮也由 dragIdx 条件隐藏
  const handleDragStart = (e: DragEvent, idx: number): void => {
    setPicking(null);
    e.dataTransfer.effectAllowed = "move";
    const btns = e.currentTarget.querySelectorAll("button");
    btns.forEach((b) => { (b as HTMLElement).style.opacity = "0"; });
    hiddenBtnsRef.current = [...hiddenBtnsRef.current, ...btns] as HTMLElement[];
    const native = e.nativeEvent as MouseEvent;
    e.dataTransfer.setDragImage(e.currentTarget as HTMLElement, native.offsetX, native.offsetY);
    setDragIdx(idx);
  };
  const handleDragEnd = (e: DragEvent): void => {
    // 恢复 hover 按钮(清 inline opacity,class 重新生效)
    e.currentTarget.querySelectorAll("button").forEach((b) => {
      (b as HTMLElement).style.opacity = "";
    });
    hiddenBtnsRef.current = [];
    setDragIdx(null);
  };

  // 只读(内置预设):仅展示色块,不可改色/拖拽/移除/添加
  if (readonly) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {colors.map((c, i) => (
          <div
            key={`${c}-${i}`}
            className="w-8 h-8 rounded-[var(--radius-lg)] border border-border shadow-sm"
            style={{ background: c }}
            
          />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-wrap items-center gap-2"
      onDragOver={(e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
      onDrop={handleContainerDrop}
    >
      {colors.map((c, i) => (
        <div
          key={`${c}-${i}`}
          data-cidx={i}
          draggable
          onDragStart={(e: DragEvent) => handleDragStart(e, i)}
          onDragOver={(e: DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
          onDragEnd={(e: DragEvent) => handleDragEnd(e)}
          onDrop={() => handleDrop(i)}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPicking({ idx: i, rect: { left: r.left, top: r.top, width: r.width, height: r.height } }); }}
          className={`group relative w-8 h-8 rounded-[var(--radius-lg)] cursor-grab border border-border shadow-sm transition-transform ${
            dragIdx === i ? "opacity-50 scale-90" : "hover:scale-105"
          }`}
          style={{ background: c }}
         
        >
          {/* 复制色块(左上角,Lucide Copy):克隆当前色块插入右侧;拖拽中不显示 */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleDuplicate(i); }}
            className={`absolute -top-1.5 -left-1.5 w-4 h-4 rounded-full bg-surface border border-border text-text-muted hover:text-accent flex items-center justify-center opacity-0 transition-opacity ${
              dragIdx === i ? "" : "group-hover:opacity-100"
            }`}
           
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          </button>
          {/* 移除颜色(右上角,Lucide X);拖拽中不显示;结构性变更 → 收起取色面板(删除会使后续 idx 前移) */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setPicking(null); onChange(colors.filter((_, j) => j !== i)); }}
            className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-surface border border-border text-text-muted hover:text-danger flex items-center justify-center opacity-0 transition-opacity ${
              dragIdx === i ? "" : "group-hover:opacity-100"
            }`}
           
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      ))}
      {/* 添加:直接加默认色,添加后点击色块即可改色;色块区 Ctrl+V 可直接粘贴剪贴板中的颜色 */}
      <button
        type="button"
        onClick={() => onChange([...colors, addColor])}
        className="w-8 h-8 rounded-[var(--radius-lg)] text-text-muted hover:text-text-secondary hover:shadow-[inset_0_0_0_999px_var(--hover-2)] text-lg flex items-center justify-center transition-all"
       
      >+</button>
      {/* 取色面板:锚定被点色块;拖拽/移除会收面板(见 handleDragStart/移除后兜底) */}
      {picking && colors[picking.idx] !== undefined && (
        <ColorPickerPanel
          key={picking.idx}
          value={colors[picking.idx] ?? addColor}
          onChange={handlePickColor}
          onClose={() => setPicking(null)}
          anchorRect={picking.rect}
          anchorEl={containerRef.current}
        />
      )}
    </div>
  );
}
