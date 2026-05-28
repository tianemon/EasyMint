#!/bin/bash

# =============================================================================
# evaluate.sh - 独立评估器
# =============================================================================
# 启动一个评估 Agent，对已完成但未评估的任务进行独立验证。
#
# 用法:
#   ./evaluate.sh              # 评估最近一个待评估任务
#   ./evaluate.sh --task 3     # 评估指定任务 ID
# =============================================================================

set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

TARGET_TASK=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --task)
            TARGET_TASK="$2"
            shift 2
            ;;
        *)
            echo "用法: $0 [--task <id>]"
            exit 1
            ;;
    esac
done

mkdir -p temp/evaluator

if [ ! -f "task.json" ]; then
    printf "${RED}[错误]${NC} 未找到 task.json！请从项目根目录运行此脚本。\n"
    exit 1
fi

# 找待评估任务
if [ -n "$TARGET_TASK" ]; then
    TASK_INFO=$(python3 -c "
import json
with open('task.json') as f:
    data = json.load(f)
for t in data['tasks']:
    if t['id'] == $TARGET_TASK:
        print(f\"{t['id']}\t{t['title']}\")
        break
" 2>/dev/null)
else
    TASK_INFO=$(python3 -c "
import json
with open('task.json') as f:
    data = json.load(f)
for t in data['tasks']:
    if t.get('passes') == True and t.get('evaluated') == False:
        print(f\"{t['id']}\t{t['title']}\")
        break
else:
    for t in data['tasks']:
        if t.get('passes') == False and t.get('evaluated') == False:
            print(f\"{t['id']}\t{t['title']}\")
            break
" 2>/dev/null)
fi

if [ -z "$TASK_INFO" ]; then
    printf "${GREEN}[完成]${NC} 没有待评估的任务。\n"
    exit 0
fi

CURRENT_TASK=$(echo "$TASK_INFO" | cut -f1 | tr -d '[:space:]')
CURRENT_TITLE=$(echo "$TASK_INFO" | cut -f2-)

printf "${BLUE}[信息]${NC} 评估任务: ${CURRENT_TITLE}\n"

# 启动评估 Agent
PROMPT_FILE=$(mktemp)
cat > "$PROMPT_FILE" << 'PROMPT_EOF'
严格按 EVALUATOR.md 流程评估一个任务。
PROMPT_EOF

LOG_FILE="temp/evaluator/eval-$(date +%Y%m%d_%H%M%S).log"

printf "${BLUE}[信息]${NC} 评估 Agent 启动，日志: $LOG_FILE\n"

START_TIME=$(date +%s)

claude -p "$(cat "$PROMPT_FILE")" \
    --permission-mode bypassPermissions \
    > "$LOG_FILE" 2>&1 &
EVAL_PID=$!

# 轮询等待评估完成
POLL_INTERVAL=60
while true; do
    sleep $POLL_INTERVAL

    if ! kill -0 "$EVAL_PID" 2>/dev/null; then
        wait "$EVAL_PID" 2>/dev/null
        EVAL_EXIT=$?
        break
    fi

    ELAPSED=$(( $(date +%s) - START_TIME ))
    MINS=$((ELAPSED / 60))
    printf "${BLUE}[信息]${NC} 评估进行中... ${MINS} 分钟\r"
done
printf "\n"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINS=$((DURATION / 60))
SECS=$((DURATION % 60))

rm -f "$PROMPT_FILE"

if [ "$EVAL_EXIT" -eq 0 ]; then
    printf "${GREEN}[成功]${NC} 评估完成（耗时 ${MINS}分${SECS}秒）\n"
else
    printf "${YELLOW}[警告]${NC} 评估 Agent 异常退出（code: $EVAL_EXIT）\n"
    # 进程失败短路，不继续统计
    rm -f "$PROMPT_FILE"
    exit $EVAL_EXIT
fi

# 检查评估结果
EVALUATED=$(python3 -c "
import json, os
with open('task.json') as f:
    data = json.load(f)
target = os.environ.get('_EVAL_TARGET', '')
if target:
    for t in data['tasks']:
        if t['id'] == int(target):
            print(t.get('evaluated', 'unknown'))
            break
else:
    count = sum(1 for t in data['tasks'] if t.get('evaluated') == True)
    print(f'{count} 个已评估')
" _EVAL_TARGET="$TARGET_TASK" 2>/dev/null)
printf "${CYAN}[统计]${NC} 评估状态: $EVALUATED\n"

# 提示查看报告
if ls temp/evaluator/report-*.md 2>/dev/null | head -1 > /dev/null; then
    printf "${CYAN}[报告]${NC} 评估报告:\n"
    ls -1 temp/evaluator/report-*.md 2>/dev/null | while read f; do
        printf "  - %s\n" "$f"
    done
fi
