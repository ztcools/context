#!/usr/bin/env bash 
set -e 

RED='\033[0;31m' 
GREEN='\033[0;32m' 
YELLOW='\033[1;33m' 
NC='\033[0m' 

INSTALL_DIR="$HOME/.claude-context" 
REPO_URL="https://github.com/ztcools/-AI-.git" 

echo -e "${GREEN}============================================${NC}" 
echo -e "${GREEN}  Claude Context 安装脚本${NC}" 
echo -e "${GREEN}============================================${NC}" 
echo "" 

echo -e "${YELLOW}[1/6] 检查 Node.js...${NC}" 
if command -v node &> /dev/null; then 
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1) 
    if [ "$NODE_VERSION" -ge 20 ]; then 
        echo -e "${GREEN}  ✓ Node.js $(node -v)${NC}" 
    else 
        echo -e "${RED}  Node.js 版本过低 (需要 >= 20)${NC}" 
        exit 1 
    fi 
else 
    echo -e "${RED}  未检测到 Node.js${NC}" 
    echo "  请先安装 Node.js 22:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "  sudo apt-get install -y nodejs"
    exit 1 
fi 

echo -e "${YELLOW}[2/6] 检查系统编译工具...${NC}" 
MISSING_TOOLS="" 
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then 
    MISSING_TOOLS="$MISSING_TOOLS python3" 
fi 
if ! command -v make &> /dev/null; then 
    MISSING_TOOLS="$MISSING_TOOLS make" 
fi 
if ! command -v gcc &> /dev/null && ! command -v g++ &> /dev/null; then 
    MISSING_TOOLS="$MISSING_TOOLS gcc/g++" 
fi 
if [ -n "$MISSING_TOOLS" ]; then 
    echo -e "${YELLOW}  缺少编译工具:${MISSING_TOOLS}${NC}" 
    echo "  better-sqlite3 需要编译原生模块，请安装：" 
    echo "  sudo apt-get install -y python3 make gcc g++" 
    echo "  或: sudo yum install -y python3 make gcc gcc-c++" 
    echo "  或: brew install python make gcc" 
    echo "" 
    echo -e "${YELLOW}  尝试继续安装（如已安装但未检测到请忽略）...${NC}" 
else 
    echo -e "${GREEN}  ✓ 编译工具就绪${NC}" 
fi 

echo -e "${YELLOW}[3/6] 检查 pnpm...${NC}" 
if command -v pnpm &> /dev/null; then 
    PNPM_VERSION=$(pnpm --version | cut -d'.' -f1)
    if [ "$PNPM_VERSION" -ge 10 ]; then
        echo -e "${GREEN}  ✓ pnpm $(pnpm --version)${NC}"
    else
        echo -e "${YELLOW}  pnpm 版本过低 (需要 >= 10)，正在升级...${NC}"
        sudo npm install -g pnpm
        echo -e "${GREEN}  ✓ pnpm 升级完成${NC}"
    fi
else 
    echo "  正在安装 pnpm（需要 sudo 权限）..." 
    sudo npm install -g pnpm 
    echo -e "${GREEN}  ✓ pnpm 安装完成${NC}" 
fi 

echo -e "${YELLOW}[4/6] 克隆仓库...${NC}" 
if [ -d "$INSTALL_DIR" ]; then 
    echo "  目录已存在，正在更新..." 
    cd "$INSTALL_DIR" 
    rm -rf node_modules packages/*/node_modules
    git fetch origin 
    git reset --hard origin/main 
else 
    git clone "$REPO_URL" "$INSTALL_DIR" 
    cd "$INSTALL_DIR" 
fi 
echo -e "${GREEN}  ✓ 仓库就绪${NC}" 

echo -e "${YELLOW}[5/6] 安装依赖 (可能需要几分钟)...${NC}" 
cd "$INSTALL_DIR" 
pnpm install
echo -e "${GREEN}  ✓ 依赖安装完成${NC}" 

echo -e "${YELLOW}[6/6] 构建项目...${NC}" 
pnpm build 
echo -e "${GREEN}  ✓ 构建完成${NC}" 

echo "" 
echo -e "${GREEN}============================================${NC}" 
echo -e "${GREEN}  环境已就绪！${NC}" 
echo -e "${GREEN}============================================${NC}" 
echo "" 
echo "  安装位置: $INSTALL_DIR" 
echo "  请按教程继续完成 MCP 配置。"
