#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  EasyMint 一键打包${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# ── 选择平台 ──

if [ -z "$1" ]; then
  echo "请选择打包平台："
  echo "  1) macOS (ARM64)"
  echo "  2) Windows (x64)"
  echo "  3) Windows (ARM64)"
  echo "  4) macOS + Windows (全部)"
  echo ""
  read -p "输入序号 [1-4]: " choice
else
  choice="$1"
fi

# ── 构建前端 ──

echo -e "${YELLOW}[1/3] 构建前端...${NC}"
npm run build:renderer --silent

echo -e "${YELLOW}[2/3] 构建主进程 & preload...${NC}"
npm run build:main --silent
npm run build:preload --silent

# ── 打包 ──

build_mac() {
  echo -e "${YELLOW}[3/3] 打包 macOS (ARM64)...${NC}"
  npx electron-builder --mac --arm64
  echo ""
  echo -e "${GREEN}✓ macOS: dist-electron/EasyMint-0.1.0-arm64.dmg${NC}"
}

build_win_x64() {
  echo -e "${YELLOW}[3/3] 打包 Windows (x64)...${NC}"
  npx electron-builder --win --x64
  echo ""
  echo -e "${GREEN}✓ Windows x64:${NC}"
  echo -e "  dist-electron/EasyMint Setup 0.1.0.exe (安装版)"
  echo -e "  dist-electron/EasyMint 0.1.0.exe        (免安装)"
}

build_win_arm64() {
  echo -e "${YELLOW}[3/3] 打包 Windows (ARM64)...${NC}"
  npx electron-builder --win --arm64
  echo ""
  echo -e "${GREEN}✓ Windows ARM64:${NC}"
  echo -e "  dist-electron/EasyMint Setup 0.1.0.exe (安装版)"
  echo -e "  dist-electron/EasyMint 0.1.0.exe        (免安装)"
}

case "$choice" in
  1)  build_mac ;;
  2)  build_win_x64 ;;
  3)  build_win_arm64 ;;
  4)
    build_mac
    build_win_x64
    build_win_arm64
    echo ""
    echo -e "${GREEN}全部打包完成！${NC}"
    ls -lh dist-electron/*.dmg dist-electron/*.exe 2>/dev/null | awk '{print "  " $NF " (" $5 ")"}'
    ;;
  *)
    echo -e "${RED}无效选择: $choice${NC}"
    exit 1
    ;;
esac
