#!/bin/bash

# =============================================================================
# run-automation.sh - 自动化任务执行器
# =============================================================================
# 用循环多次运行 Claude Code，自动完成 task.json 中定义的任务。
#
# 用法: ./run-automation.sh <运行次数>
# 示例: ./run-automation.sh 5
# =============================================================================

set -eo pipefail

# 日志颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 日志文件
LOG_DIR="./temp/automation-logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/automation-$(date +%Y%m%d_%H%M%S).log"

# 日志函数
log() {
    local level=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    printf "%s [%s] %s\n" "$timestamp" "$level" "$message" >> "$LOG_FILE"

    case $level in
        INFO)
            printf "${BLUE}[信息]${NC} %s\n" "$message"
            ;;
        SUCCESS)
            printf "${GREEN}[成功]${NC} %s\n" "$message"
            ;;
        WARNING)
            printf "${YELLOW}[警告]${NC} %s\n" "$message"
            ;;
        ERROR)
            printf "${RED}[错误]${NC} %s\n" "$message"
            ;;
        PROGRESS)
            printf "${CYAN}[进度]${NC} %s\n" "$message"
            ;;
    esac
}

# 格式化时长为中文
format_duration() {
    local seconds=$1
    local min=$((seconds / 60))
    local sec=$((seconds % 60))
    if [ $min -gt 0 ] && [ $sec -gt 0 ]; then
        echo "${min}分${sec}秒"
    elif [ $min -gt 0 ]; then
        echo "${min}分钟"
    else
        echo "${sec}秒"
    fi
}

# 统计剩余任务数
count_remaining_tasks() {
    if [ -f "task.json" ]; then
        grep -c '"passes": false' task.json 2>/dev/null | tr -d '[:space:]' || echo "0"
    else
        echo "0"
    fi
}

# 获取第一个未完成任务的信息（输出: id<TAB>标题）
get_current_task_info() {
    if [ -f "task.json" ]; then
        python3 -c "
import json
with open('task.json') as f:
    data = json.load(f)
for t in data['tasks']:
    if not t['passes']:
        print(f\"{t['id']}\t{t['title']}\")
        break
" 2>/dev/null
    fi
}

# 检查指定任务是否已完成
check_task_done() {
    local task_id=$1
    if [ -z "$task_id" ]; then
        return 1
    fi
    python3 -c "
import json, sys
with open('task.json') as f:
    data = json.load(f)
for t in data['tasks']:
    if t['id'] == $task_id:
        sys.exit(0 if t['passes'] else 1)
sys.exit(1)
" 2>/dev/null
}

# 解析参数
EVALUATE_MODE=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --evaluate)
            EVALUATE_MODE=true
            shift
            ;;
        *)
            if [[ "$1" =~ ^[0-9]+$ ]]; then
                TOTAL_RUNS=$1
            else
                echo "用法: $0 <运行次数> [--evaluate]"
                echo "示例: $0 5           # 纯 builder 轮次"
                echo "      $0 3 --evaluate # builder → evaluator 交替"
                exit 1
            fi
            shift
            ;;
    esac
done

# 检查是否提供了运行次数参数
if [ -z "$TOTAL_RUNS" ]; then
    echo "用法: $0 <运行次数> [--evaluate]"
    echo "示例: $0 5           # 纯 builder 轮次"
    echo "      $0 3 --evaluate # builder → evaluator 交替"
    exit 1
fi

# Banner
echo ""
echo "========================================"
printf "  Claude Code 自动化执行器\n"
echo "========================================"
echo ""

log "INFO" "开始自动化，共 $TOTAL_RUNS 轮，任务完成会提前结束"
log "INFO" "主日志: $LOG_FILE"

# 检查 task.json 是否存在
if [ ! -f "task.json" ]; then
    log "ERROR" "未找到 task.json！请从项目根目录运行此脚本。"
    exit 1
fi

# 初始任务统计
INITIAL_TASKS=$(count_remaining_tasks)

# 主循环
for ((run=1; run<=TOTAL_RUNS; run++)); do
    echo ""
    echo "========================================"
    log "PROGRESS" "第 $run / $TOTAL_RUNS 轮"
    echo "========================================"

    # 本轮运行前检查剩余任务
    REMAINING=$(count_remaining_tasks)

    if [ "$REMAINING" -eq 0 ]; then
        log "SUCCESS" "所有任务已完成！无需继续。"
        log "INFO" "自动化在第 $((run-1)) 轮后提前结束"
        exit 0
    fi

    # 记录本轮要做的任务
    TASK_INFO=$(get_current_task_info)
    CURRENT_TASK=$(echo "$TASK_INFO" | cut -f1 | tr -d '[:space:]')
    CURRENT_TITLE=$(echo "$TASK_INFO" | cut -f2-)
    if [ -z "$CURRENT_TASK" ]; then
        log "WARNING" "无法确定当前任务，跳过本轮"
        continue
    fi

    log "INFO" "剩余 $REMAINING 个任务，当前: $CURRENT_TITLE"

    # 本轮时间戳
    RUN_START=$(date +%s)
    RUN_LOG="$LOG_DIR/run-${run}-$(date +%Y%m%d_%H%M%S).log"

    log "INFO" "启动 Claude 会话，日志: $RUN_LOG"

    # 创建带 prompt 的临时文件
    PROMPT_FILE=$(mktemp)
    cat > "$PROMPT_FILE" << 'PROMPT_EOF'
严格按 WORKER.md 流程完成一个任务。
PROMPT_EOF

    # 后台启动 Claude
    # --output-format stream-json 输出到 .jsonl，stderr 输出到 .log，
    # 用于排查 "任务完成但不退出" 的问题。
    claude -p "$(cat "$PROMPT_FILE")" \
        --permission-mode bypassPermissions \
        --output-format stream-json \
        --verbose \
        > "${RUN_LOG}.jsonl" 2>"$RUN_LOG" &
    CLAUDE_PID=$!

    log "INFO" "Claude 已启动 (PID: $CLAUDE_PID)，每分钟检查任务状态..."

    # 轮询等待：任务完成或进程退出
    POLL_INTERVAL=60
    POLL_START=$(date +%s)
    EXIT_REASON=""

    TASK_DONE_AT=""

    while true; do
        sleep $POLL_INTERVAL

        # 检查 Claude 是否还活着
        if ! kill -0 "$CLAUDE_PID" 2>/dev/null; then
            wait "$CLAUDE_PID" 2>/dev/null
            CLAUDE_EXIT=$?
            EXIT_REASON="claude"
            break
        fi

        # 检查任务是否完成
        if [ -z "$TASK_DONE_AT" ] && check_task_done "$CURRENT_TASK"; then
            TASK_DONE_AT=$(date +%s)
            log "SUCCESS" "任务已标记完成，等待 Claude 自然退出（最多 120 秒）..."
        fi

        # 任务完成后给 120 秒让 Claude 自己退出
        if [ -n "$TASK_DONE_AT" ]; then
            GRACE_ELAPSED=$(($(date +%s) - TASK_DONE_AT))
            if [ $GRACE_ELAPSED -ge 120 ]; then
                log "WARNING" "Claude 仍未退出，强制终止"
                kill "$CLAUDE_PID" 2>/dev/null || true
                sleep 2
                if kill -0 "$CLAUDE_PID" 2>/dev/null; then
                    kill -9 "$CLAUDE_PID" 2>/dev/null || true
                fi
                wait "$CLAUDE_PID" 2>/dev/null || true
                EXIT_REASON="killed"
                break
            fi
        fi

        NOW=$(date +%s)
        ELAPSED=$((NOW - POLL_START))
        printf "${BLUE}[信息]${NC} $CURRENT_TITLE — 已进行 %s\r\033[K" "$(format_duration $ELAPSED)"
    done
    printf "\n"

    RUN_END=$(date +%s)
    RUN_DURATION=$((RUN_END - RUN_START))

    # 诊断摘要
    DURATION_STR=$(format_duration $RUN_DURATION)
    if [ "$EXIT_REASON" = "killed" ]; then
        log "SUCCESS" "第 $run 轮完成（已终止 Claude），耗时 $DURATION_STR"
    elif [ "$CLAUDE_EXIT" -eq 0 ]; then
        log "SUCCESS" "第 $run 轮完成（Claude 自行退出），耗时 $DURATION_STR"
    else
        log "WARNING" "第 $run 轮结束（Claude 异常退出），耗时 $DURATION_STR"
    fi

    # 清理临时文件
    rm -f "$PROMPT_FILE"

    # 本轮后检查剩余任务
    REMAINING_AFTER=$(count_remaining_tasks)
    COMPLETED=$((REMAINING - REMAINING_AFTER))

    if [ "$COMPLETED" -gt 0 ]; then
        log "SUCCESS" "本轮完成任务数: $COMPLETED"
    elif [ "$CLAUDE_EXIT" -ne 0 ]; then
        log "WARNING" "本轮没有任务被标记为完成（会话异常退出）"
    else
        log "WARNING" "本轮没有任务被标记为完成"
    fi

    log "INFO" "第 $run 轮后剩余任务数: $REMAINING_AFTER"

    # 日志分隔符
    echo "" >> "$LOG_FILE"
    echo "----------------------------------------" >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"

    # 评估阶段（--evaluate 模式）
    if [ "$EVALUATE_MODE" = true ]; then
        log "INFO" "启动评估 Agent..."
        ./evaluate.sh >> "$LOG_FILE" 2>&1
        EVAL_EXIT=$?
        if [ $EVAL_EXIT -eq 0 ]; then
            log "SUCCESS" "评估通过"
        else
            log "WARNING" "评估发现问题，下一轮 builder 将修复"
        fi
    fi

    # 轮次间隔
    if [ $run -lt $TOTAL_RUNS ]; then
        log "INFO" "等待 2 秒后开始下一轮..."
        sleep 2
    fi
done

# 最终汇总
echo ""
echo "========================================"
log "SUCCESS" "自动化执行完毕！"
echo "========================================"

FINAL_REMAINING=$(count_remaining_tasks)
TOTAL_COMPLETED=$((INITIAL_TASKS - FINAL_REMAINING))

log "INFO" "汇总:"
log "INFO" "  - 总运行轮数: $TOTAL_RUNS"
log "INFO" "  - 已完成任务: $TOTAL_COMPLETED"
log "INFO" "  - 剩余任务: $FINAL_REMAINING"
log "INFO" "  - 日志文件: $LOG_FILE"

if [ "$FINAL_REMAINING" -eq 0 ]; then
    log "SUCCESS" "所有任务已完成！"
else
    log "WARNING" "仍有任务未完成，可以增加运行轮数继续。"
fi
