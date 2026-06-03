#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PLATFORMS=(
  "mac-arm64|macOS (Apple Silicon)"
  "mac-x64|macOS (Intel)"
  "win-x64|Windows (x64)"
  "win-arm64|Windows (ARM64)"
)

# ── 解析命令行参数 ──

SELECTED=()
if [ $# -gt 0 ]; then
  for arg in "$@"; do
    case "$arg" in
      mac-arm64|mac-x64|win-x64|win-arm64)
        SELECTED+=("$arg")
        ;;
      all)
        for p in "${PLATFORMS[@]}"; do
          SELECTED+=("${p%%|*}")
        done
        ;;
      *)
        echo -e "${RED}未知平台: $arg${NC}"
        echo "可用: mac-arm64, mac-x64, win-x64, win-arm64, all"
        exit 1
        ;;
    esac
  done
fi

# ── 交互选择 ──

if [ ${#SELECTED[@]} -eq 0 ]; then
  echo ""
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}  EasyMint 一键打包${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  echo "选择平台（输入序号，空格分隔，如 1 3）："
  echo ""
  for i in "${!PLATFORMS[@]}"; do
    key="${PLATFORMS[$i]%%|*}"
    label="${PLATFORMS[$i]##*|}"
    printf "  %s) %-30s" "$((i+1))" "$label"
    if [ $((i % 2)) -eq 1 ]; then echo ""; fi
  done
  [ $(( ${#PLATFORMS[@]} % 2 )) -eq 1 ] && echo ""
  echo ""
  echo "  a) 全部"
  echo ""
  read -p "输入: " input

  for item in $input; do
    case "$item" in
      a|A)
        for p in "${PLATFORMS[@]}"; do
          SELECTED+=("${p%%|*}")
        done
        ;;
      [1-4])
        idx=$((item - 1))
        SELECTED+=("${PLATFORMS[$idx]%%|*}")
        ;;
      *)
        echo -e "${RED}无效选择: $item${NC}"
        exit 1
        ;;
    esac
  done
fi

if [ ${#SELECTED[@]} -eq 0 ]; then
  echo -e "${RED}未选择任何平台${NC}"
  exit 1
fi

echo ""
echo -e "${CYAN}已选择: ${SELECTED[*]}${NC}"

# ── 构建前端 ──

echo -e "${YELLOW}[1/3] 构建前端...${NC}"
npm run build:renderer --silent

echo -e "${YELLOW}[2/3] 构建主进程 & preload...${NC}"
npm run build:main --silent
npm run build:preload --silent

# 清理中间解包目录（安装包会被 electron-builder 自动覆盖）
rm -rf dist-electron/mac-arm64 dist-electron/mac dist-electron/win-arm64-unpacked dist-electron/win-unpacked dist-electron/.icon-ico dist-electron/builder-debug.yml 2>/dev/null || true

# ── 打包 ──

STEP=3
TOTAL=$(( STEP - 1 + ${#SELECTED[@]} ))

for platform in "${SELECTED[@]}"; do
  echo ""
  echo -e "${YELLOW}[$STEP/$TOTAL] 打包 $platform...${NC}"

  case "$platform" in
    mac-arm64)
      rm -rf node_modules/@anthropic-ai/claude-agent-sdk-win32-*
      npx electron-builder --mac --arm64
      mv dist-electron/EasyMint-macOS-arm64.dmg dist-electron/EasyMint-macOS-AppleSilicon.dmg 2>/dev/null || true
      echo -e "${GREEN}✓ dist-electron/EasyMint-macOS-AppleSilicon.dmg${NC}"
      ;;
    mac-x64)
      rm -rf node_modules/@anthropic-ai/claude-agent-sdk-win32-*
      npx electron-builder --mac --x64
      mv dist-electron/EasyMint-macOS-x64.dmg dist-electron/EasyMint-macOS-Intel.dmg 2>/dev/null || true
      echo -e "${GREEN}✓ dist-electron/EasyMint-macOS-Intel.dmg${NC}"
      ;;
    win-x64)
      # Remove macOS SDK binaries so they don't leak into Windows build
      mv node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64 /tmp/easymint-darwin-arm64 2>/dev/null || true
      mv node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64 /tmp/easymint-darwin-x64 2>/dev/null || true
      [ -d node_modules/@anthropic-ai/claude-agent-sdk-win32-x64 ] || npm install @anthropic-ai/claude-agent-sdk-win32-x64@0.3.161 --no-save --force
      CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win --x64
      # Restore macOS binaries
      mv /tmp/easymint-darwin-arm64 node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64 2>/dev/null || true
      mv /tmp/easymint-darwin-x64 node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64 2>/dev/null || true
      echo -e "${GREEN}✓ Windows x64:${NC}"
      echo "  dist-electron/EasyMint-windows-x64.exe (安装版)"
      echo "  dist-electron/EasyMint-windows-x64-portable.exe (免安装)"
      ;;
    win-arm64)
      mv node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64 /tmp/easymint-darwin-arm64 2>/dev/null || true
      mv node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64 /tmp/easymint-darwin-x64 2>/dev/null || true
      [ -d node_modules/@anthropic-ai/claude-agent-sdk-win32-arm64 ] || npm install @anthropic-ai/claude-agent-sdk-win32-arm64@0.3.161 --no-save --force
      CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win --arm64
      mv /tmp/easymint-darwin-arm64 node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64 2>/dev/null || true
      mv /tmp/easymint-darwin-x64 node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64 2>/dev/null || true
      echo -e "${GREEN}✓ Windows ARM64:${NC}"
      echo "  dist-electron/EasyMint-windows-arm64.exe (安装版)"
      echo "  dist-electron/EasyMint-windows-arm64-portable.exe (免安装)"
      ;;
  esac

  STEP=$((STEP + 1))
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  打包完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
ls -lh dist-electron/*.dmg dist-electron/*.exe 2>/dev/null | awk '{printf "  %-50s %s\n", $NF, $5}'
