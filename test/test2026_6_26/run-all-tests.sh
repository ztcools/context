#!/usr/bin/env bash
# =============================================================================
# Claude Context MCP 全面测试套件
# 测试日期: 2026-06-26
# 分支: feature/remove-absolute-path-references
# =============================================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ROOT="/home/zt/claude-context"
TEST_DIR="$PROJECT_ROOT/test/test2026"
PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  Claude Context MCP 全面测试${NC}"
echo -e "${BLUE}  分支: feature/remove-absolute-path-references${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# ─── 环境检查 ──────────────────────────────────────────────────────

echo -e "${YELLOW}[环境检查]${NC}"

# Node.js
if command -v node &> /dev/null; then
    echo -e "  ${GREEN}✓${NC} Node.js $(node -v)"
else
    echo -e "  ${RED}✗${NC} Node.js 未安装"
    exit 1
fi

# 检查 MCP 服务是否运行
if curl -s http://10.50.4.149:11435 > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Ollama (10.50.4.149:11435) 可达"
else
    echo -e "  ${YELLOW}⚠${NC} Ollama 不可达，部分测试可能跳过"
fi

if curl -s http://10.50.4.149:19530 > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Milvus (10.50.4.149:19530) 可达"
else
    echo -e "  ${YELLOW}⚠${NC} Milvus 不可达，部分测试可能跳过"
fi

# 检查测试仓库
echo ""
echo -e "${YELLOW}[测试资源]${NC}"
for repo in "https://github.com/ztcools/LSMKV.git" \
            "https://github.com/ztcools/code-study-record.git" \
            "https://github.com/ztcools/TitanBench.git" \
            "https://github.com/ztcools/qt-teaching-management-system.git" \
            "https://github.com/ztcools/-AI-.git"; do
    repo_name=$(basename "$repo" .git)
    if git ls-remote "$repo" &>/dev/null; then
        echo -e "  ${GREEN}✓${NC} $repo_name"
    else
        echo -e "  ${RED}✗${NC} $repo_name 不可达"
    fi
done

# ─── 执行测试 ──────────────────────────────────────────────────────

run_test() {
    local test_name="$1"
    local test_file="$2"
    TOTAL_COUNT=$((TOTAL_COUNT + 1))

    echo ""
    echo -e "${BLUE}─── 测试${NC} ${test_name} ${BLUE}───${NC}"

    if node --import tsx --test "$test_file" 2>&1; then
        echo -e "${GREEN}  ✓ PASS${NC}"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "${RED}  ✗ FAIL${NC}"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

echo ""
echo -e "${YELLOW}[执行测试]${NC}"

# 测试1: 基础工具功能
run_test "基础工具功能" "$TEST_DIR/test-basic-tools.ts"

# 测试2: url+branch 隔离
run_test "url+branch 隔离" "$TEST_DIR/test-url-branch-isolation.ts"

# 测试3: 路径解析
run_test "路径解析" "$TEST_DIR/test-path-resolution.ts"

# 测试4: 多仓库场景
run_test "多仓库场景" "$TEST_DIR/test-multi-repo.ts"

# 测试5: Token 效率
run_test "Token 效率" "$TEST_DIR/test-token-efficiency.ts"

# 测试6: 工具描述
run_test "工具描述" "$TEST_DIR/test-tool-descriptions.ts"

# ─── 结果汇总 ──────────────────────────────────────────────────────

echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  测试结果汇总${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""
echo -e "  总计: ${TOTAL_COUNT}"
echo -e "  ${GREEN}通过: ${PASS_COUNT}${NC}"
echo -e "  ${RED}失败: ${FAIL_COUNT}${NC}"
echo ""

if [ "$FAIL_COUNT" -eq 0 ]; then
    echo -e "${GREEN}  ✓ 全部测试通过！可以上线。${NC}"
    exit 0
else
    echo -e "${RED}  ✗ 存在失败测试，需要修复后重新测试。${NC}"
    exit 1
fi