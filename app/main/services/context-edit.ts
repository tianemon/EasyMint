/**
 * 「单条移出上下文」（轻档，见 agent-service.setEntryInContext）落盘形态的解析——纯函数，配单测。
 *
 * 为什么单独一个文件：这条判定必须与 SDK 的投影规则**逐字对齐**，而它依赖的是条目字段名
 * （`context_edit` / `targetId` / `replacement`）。字段改名或语义变化时，这里错一点就表现为
 * 「历史里那条看着还在上下文里，模型其实看不到」这种没有任何报错的静默偏差；集中在此便于单测覆盖。
 */

/**
 * 从（当前分支的）条目列表里算出**此刻被移出上下文**的条目 id 集合。
 *
 * 落盘形态：`appendContextEdit(targetId, null)` 追加一条 `context_edit` 条目（replacement 为 null）＝摘掉目标；
 * 恢复则再追加一条带原内容的编辑。关键是**同一目标只有最后一条编辑生效**
 * （SDK `buildSessionProjection` 用一个 Map 按条目顺序写入，后写覆盖先写），所以这里是
 * 「按文件顺序后写覆盖先写」，而不是「历史上出现过 null 就永远算摘掉」——否则恢复过的条目会被误标。
 */
export function droppedContextIds(entries: readonly unknown[]): Set<string> {
  const dropped = new Set<string>();
  for (const raw of entries) {
    const entry = raw as { type?: string; targetId?: string; replacement?: unknown } | null;
    if (!entry || entry.type !== "context_edit" || !entry.targetId) continue;
    if (entry.replacement === null) dropped.add(entry.targetId);
    else dropped.delete(entry.targetId);
  }
  return dropped;
}

/** Targets whose latest context edit removed image blocks while keeping the message itself. */
export function imageStrippedContextIds(entries: readonly unknown[]): Set<string> {
  const originalImages = new Set<string>();
  for (const raw of entries) {
    const entry = raw as { id?: string; type?: string; message?: { content?: unknown }; content?: unknown } | null;
    if (!entry?.id) continue;
    const content = entry.type === "message" ? entry.message?.content : entry.type === "custom_message" ? entry.content : undefined;
    if (Array.isArray(content) && content.some((block) => block?.type === "image")) originalImages.add(entry.id);
  }
  const stripped = new Set<string>();
  for (const raw of entries) {
    const edit = raw as { type?: string; targetId?: string; replacement?: { content?: unknown } | null } | null;
    if (edit?.type !== "context_edit" || !edit.targetId || !originalImages.has(edit.targetId)) continue;
    const content = edit.replacement?.content;
    if (Array.isArray(content) && !content.some((block) => block?.type === "image")) stripped.add(edit.targetId);
    else stripped.delete(edit.targetId);
  }
  return stripped;
}
