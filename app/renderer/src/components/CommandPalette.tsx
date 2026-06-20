import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSettingsStore, type SlashCommandInfo, COMMAND_CATEGORIES } from "../stores/settings-store";

interface CommandPaletteProps {
  initialQuery?: string;
  onClose: () => void;
  onPick: (commandText: string) => void;
}

export function CommandPalette({ initialQuery = "", onClose, onPick }: CommandPaletteProps): JSX.Element {
  const commands = useSettingsStore((s) => s.availableCommands);
  const [query, setQuery] = useState(initialQuery);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 同步外部 / 前缀打字的过滤词
  useEffect(() => { setQuery(initialQuery); setActiveIdx(0); }, [initialQuery]);

  // 按钮触发时自动聚焦搜索框
  useEffect(() => {
    if (!initialQuery) inputRef.current?.focus();
  }, [initialQuery]);

  // 按分类分组 + 搜索过滤
  const groups = useMemo(() => {
    const q = query.replace(/^\//, "").toLowerCase().trim();
    const nameIndex = new Map<string, SlashCommandInfo>();
    for (const c of commands) nameIndex.set(c.name, c);

    // 未在分类表里的命令自动纳入"其他"
    const categorized = new Set<string>();
    const result: { key: string; label: string; items: SlashCommandInfo[] }[] = [];

    for (const cat of COMMAND_CATEGORIES) {
      const items: SlashCommandInfo[] = [];
      for (const name of cat.names) {
        const cmd = nameIndex.get(name);
        if (cmd) { items.push(cmd); categorized.add(name); }
      }
      // 无搜索词 → 全展示；有搜索词 → 只展示有匹配的分组
      if (!q || items.some((c) => matchCmd(c, q))) {
        result.push({ key: cat.key, label: cat.label, items: !q ? items : items.filter((c) => matchCmd(c, q)) });
      }
    }

    // 未分类命令
    const uncat = commands.filter((c) => !categorized.has(c.name));
    if (uncat.length > 0) {
      if (!q || uncat.some((c) => matchCmd(c, q))) {
        result.push({ key: "other", label: "其他", items: !q ? uncat : uncat.filter((c) => matchCmd(c, q)) });
      }
    }

    return result;
  }, [commands, query]);

  // 扁平索引用于键盘导航
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    if (activeIdx >= flat.length) setActiveIdx(Math.max(0, flat.length - 1));
  }, [flat.length, activeIdx]);

  // 键盘事件委托到 document（输入框聚焦在 textarea 时仍可导航）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(flat.length - 1, i + 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const target = flat[activeIdx];
        if (target) onPick(`/${target.name}${target.argumentHint ? " " : ""}`);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [flat, activeIdx, onClose, onPick]);

  const handlePick = (cmd: SlashCommandInfo): void => {
    onPick(`/${cmd.name}${cmd.argumentHint ? " " : ""}`);
  };

  let flatIdx = 0;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div ref={panelRef} className="absolute left-3 bottom-[110px] z-50 w-[520px] max-h-[420px] flex flex-col rounded-lg border border-border bg-surface-elevated shadow-2xl overflow-hidden">
        <div className="px-3 py-2 border-b border-border shrink-0">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            placeholder="搜索命令..."
            className="w-full bg-transparent text-[13px] text-text-primary placeholder-text-secondary outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-1.5">
          {groups.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-text-secondary">
              {commands.length === 0 ? "命令列表加载中（首次会话开始后自动同步）" : "无匹配命令"}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.key} className="mb-2">
                <div className="text-[10.5px] font-semibold text-text-secondary uppercase tracking-wider px-2 py-1">{group.label}</div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {group.items.map((cmd) => {
                      const isActive = flatIdx === activeIdx;
                      const idx = flatIdx++;
                      return (
                        <tr
                          key={cmd.name}
                          data-idx={idx}
                          className={`cursor-pointer transition-colors ${isActive ? "bg-accent/10 rounded" : "hover:bg-surface-hover rounded"}`}
                          onMouseEnter={() => setActiveIdx(idx)}
                          onClick={() => handlePick(cmd)}
                        >
                          <td className="py-1 pl-2 pr-3 align-top whitespace-nowrap">
                            <span className={`font-mono text-[12px] ${isActive ? "text-accent" : "text-text-primary"}`}>/{cmd.name}</span>
                            {cmd.argumentHint && (
                              <span className="font-mono text-[10.5px] text-text-secondary ml-1">{cmd.argumentHint}</span>
                            )}
                          </td>
                          <td className="py-1 pr-2 text-[11.5px] text-text-secondary leading-snug">
                            {cmd.description}
                            {cmd.aliases && cmd.aliases.length > 0 && (
                              <span className="text-[10px] text-text-secondary ml-2">别名: {cmd.aliases.map((a) => `/${a}`).join(", ")}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
        <div className="px-3 py-1.5 border-t border-border bg-surface-alt/40 text-[10.5px] text-text-secondary flex items-center gap-3 shrink-0">
          <span>↑↓ 选择</span>
          <span>Enter 填入输入框</span>
          <span>Esc 关闭</span>
          <div className="flex-1" />
          <span>{flat.length} 项</span>
        </div>
      </div>
    </>
  );
}

function matchCmd(cmd: SlashCommandInfo, q: string): boolean {
  if (cmd.name.toLowerCase().includes(q)) return true;
  if (cmd.description?.toLowerCase().includes(q)) return true;
  if (cmd.aliases?.some((a) => a.toLowerCase().includes(q))) return true;
  return false;
}
