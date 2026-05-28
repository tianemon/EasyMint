#!/bin/bash

# =============================================================================
# init.sh - EasyMint 开发环境初始化
# =============================================================================
# 检测 Node.js 运行时、安装 npm 依赖、确保开发环境就绪。
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="."

echo ""
echo "========================================"
echo "  EasyMint 环境初始化"
echo "========================================"
echo ""

# =============================================================================
# 1. 环境检测
# =============================================================================

echo -e "${YELLOW}检测开发环境...${NC}"

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo -e "  ${GREEN}✓${NC} Node.js ${NODE_VERSION}"
else
    echo -e "  ${RED}✗${NC} Node.js 未安装，请先安装 Node.js >= 18"
    exit 1
fi

if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    echo -e "  ${GREEN}✓${NC} npm ${NPM_VERSION}"
else
    echo -e "  ${RED}✗${NC} npm 未安装"
    exit 1
fi

# Claude CLI（可选，仅警告）
if command -v claude &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} Claude CLI"
else
    echo -e "  ${YELLOW}⚠${NC} Claude CLI 未检测到（EasyMint 需要 claude 命令行工具）"
fi

echo ""

# =============================================================================
# 2. 安装依赖
# =============================================================================

echo -e "${YELLOW}安装依赖...${NC}"

cd "$PROJECT_DIR" && npm install && cd - > /dev/null

echo ""

# =============================================================================
# 3. 验证构建
# =============================================================================

echo -e "${YELLOW}验证 TypeScript 编译...${NC}"

npx tsc --noEmit -p app/renderer/tsconfig.json 2>/dev/null || true

echo ""

echo -e "${GREEN}========================================"
echo "  环境就绪！"
echo -e "=======================================${NC}"
echo ""
echo "运行 npm run dev 启动 EasyMint 开发模式。"
echo ""
