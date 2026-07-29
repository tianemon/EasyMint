#!/bin/bash
# ============================================================================
# EasyMint 会话迁移：Claude SDK JSONL → Pi SDK SessionEntry
#
# 用法：
#   bash scripts/migrate-sessions.sh
#
# 说明：
#   旧会话位置: ~/.easymint/projects/<编码路径>/<sessionId>.jsonl
#   新会话位置: ~/.easymint/sessions/<编码路径>/<sessionId>.jsonl
#
#   每个旧 JSONL 行是 Claude SDK 消息，新 JSONL 行是 Pi SessionEntry。
#   本脚本：
#     1. 扫描旧会话目录
#     2. 对每个 JSONL，提取 user/assistant 消息
#     3. 转换为 Pi SessionEntry 格式写入新目录
#     4. 复制会话元数据（标题、置顶、归档）
# ============================================================================

set -e

OLD_DIR="$HOME/.easymint/projects"
NEW_DIR="$HOME/.easymint/sessions"
SESSION_TYPES="$HOME/.easymint/session-types.json"

MIGRATED=0
SKIPPED=0

echo "=== EasyMint 会话迁移 ==="
echo "旧目录: $OLD_DIR"
echo "新目录: $NEW_DIR"
echo ""

# 检查旧目录是否存在
if [ ! -d "$OLD_DIR" ]; then
  echo "✅ 没有旧会话需要迁移（$OLD_DIR 不存在）"
  exit 0
fi

# 确保新目录存在
mkdir -p "$NEW_DIR"

# UUID 生成
uuid() {
  python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || \
  node -e "console.log(require('crypto').randomUUID())" 2>/dev/null || \
  echo "$(date +%s)-$$-$RANDOM"
}

NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# 遍历所有项目目录
for PROJECT_DIR in "$OLD_DIR"/*/; do
  [ -d "$PROJECT_DIR" ] || continue
  PROJECT_NAME=$(basename "$PROJECT_DIR")
  NEW_PROJECT_DIR="$NEW_DIR/$PROJECT_NAME"
  mkdir -p "$NEW_PROJECT_DIR"

  echo "📁 项目: $PROJECT_NAME"

  # 遍历项目下的所有 JSONL 会话文件
  for JSONL_FILE in "$PROJECT_DIR"*.jsonl; do
    [ -f "$JSONL_FILE" ] || continue
    SESSION_FILE=$(basename "$JSONL_FILE")
    SESSION_ID="${SESSION_FILE%.jsonl}"
    NEW_SESSION_FILE="$NEW_PROJECT_DIR/$SESSION_FILE"

    # 跳过已迁移的
    if [ -f "$NEW_SESSION_FILE" ]; then
      echo "  ⏭️  $SESSION_ID（已存在，跳过）"
      SKIPPED=$((SKIPPED + 1))
      continue
    fi

    echo "  🔄 $SESSION_ID"

    # 逐行转换：Claude SDK message → Pi SessionEntry
    LINE_COUNT=0
    while IFS= read -r LINE; do
      [ -z "$LINE" ] && continue

      TYPE=$(echo "$LINE" | python3 -c "
import json, sys
try:
    msg = json.loads(sys.stdin.read())
    role = msg.get('message', {}).get('role', '') or msg.get('role', '')
    if role == 'user': print('user')
    elif role == 'assistant': print('assistant')
    else: print('skip')
except: print('skip')
" 2>/dev/null || echo "skip")

      if [ "$TYPE" = "skip" ]; then
        continue
      fi

      # 生成 Pi SessionEntry（message 类型）
      ENTRY_ID=$(uuid)
      ENTRY_TS=$(echo "$LINE" | python3 -c "
import json, sys
try:
    msg = json.loads(sys.stdin.read())
    ts = msg.get('timestamp') or msg.get('created_at') or 0
    print(int(ts))
except: print(0)
" 2>/dev/null || echo "0")

      # 时间戳归一化
      if [ "$ENTRY_TS" = "0" ] || [ "$ENTRY_TS" -lt 1000000000000 ] 2>/dev/null; then
        ENTRY_TS=$(date +%s000 2>/dev/null || echo "0")
      fi

      # 写入 Pi SessionEntry
      cat >> "$NEW_SESSION_FILE" << JSONL
{"type":"message","id":"$ENTRY_ID","timestamp":$ENTRY_TS,"message":$LINE}
JSONL

      LINE_COUNT=$((LINE_COUNT + 1))
    done < "$JSONL_FILE"

    # 追加 session 头
    HEADER_ID=$(uuid)
    # 在文件开头插入 header
    if [ "$LINE_COUNT" -gt 0 ]; then
      HEADER_JSON="{\"type\":\"header\",\"id\":\"$HEADER_ID\",\"timestamp\":$ENTRY_TS,\"version\":1}"
      # 使用临时文件插入 header
      TMP_FILE="$NEW_SESSION_FILE.tmp"
      echo "$HEADER_JSON" > "$TMP_FILE"
      cat "$NEW_SESSION_FILE" >> "$TMP_FILE"
      mv "$TMP_FILE" "$NEW_SESSION_FILE"
      echo "     ✅ $LINE_COUNT 条消息已迁移"
      MIGRATED=$((MIGRATED + 1))
    else
      rm -f "$NEW_SESSION_FILE"
      echo "     ⚠️  无有效消息，跳过"
    fi
  done
  echo ""
done

# ── 迁移元数据 ────────────────────────────────────────

echo "=== 迁移元数据 ==="

# session-titles
OLD_TITLES="$HOME/.easymint/session-titles.json"
NEW_TITLES="$HOME/.easymint/session-titles.json"
if [ -f "$OLD_TITLES" ] && [ ! -f "$NEW_TITLES" ]; then
  cp "$OLD_TITLES" "$NEW_TITLES"
  echo "✅ session-titles.json"
else
  echo "⏭️  session-titles.json（已存在或无旧数据）"
fi

# pinned-sessions
OLD_PINNED="$HOME/.easymint/pinned-sessions.json"
NEW_PINNED="$HOME/.easymint/pinned-sessions.json"
if [ -f "$OLD_PINNED" ] && [ ! -f "$NEW_PINNED" ]; then
  cp "$OLD_PINNED" "$NEW_PINNED"
  echo "✅ pinned-sessions.json"
else
  echo "⏭️  pinned-sessions.json（已存在或无旧数据）"
fi

# archived-sessions
OLD_ARCHIVED="$HOME/.easymint/archived-sessions.json"
NEW_ARCHIVED="$HOME/.easymint/archived-sessions.json"
if [ -f "$OLD_ARCHIVED" ] && [ ! -f "$NEW_ARCHIVED" ]; then
  cp "$OLD_ARCHIVED" "$NEW_ARCHIVED"
  echo "✅ archived-sessions.json"
else
  echo "⏭️  archived-sessions.json（已存在或无旧数据）"
fi

echo ""
echo "=== 迁移完成 ==="
echo "已迁移: $MIGRATED 个会话"
echo "已跳过: $SKIPPED 个会话"
echo ""
echo "旧数据仍保留在 $OLD_DIR，确认新会话正常后可手动删除："
echo "  rm -rf $OLD_DIR"
