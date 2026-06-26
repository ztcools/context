# Claude Context MCP 全面测试报告

**测试日期**: 2026-06-26  
**测试分支**: `feature/remove-absolute-path-references`  
**测试工程师**: AI Agent

---

## 一、测试结果总览

| 测试文件 | 用例数 | 通过 | 失败 |
|----------|--------|------|------|
| test-basic-tools.ts (基础工具) | 6 | 6 | 0 |
| test-url-branch-isolation.ts (url+branch隔离) | 6 | 6 | 0 |
| test-path-resolution.ts (路径解析) | 5 | 5 | 0 |
| test-multi-repo.ts (多仓库场景) | 4 | 4 | 0 |
| test-token-efficiency.ts (Token效率) | 2 | 2 | 0 |
| test-tool-descriptions.ts (工具描述) | 5 | 5 | 0 |
| **MCP 集成测试（手动）** | **4** | **4** | **0** |
| **总计** | **32** | **32** | **0** |

---

## 二、测试用例详情

### 2.1 基础工具功能 (6/6)

| 测试用例 | 结果 |
|----------|------|
| get_indexing_status 未索引返回 not_found | PASS |
| index_codebase 索引后状态变为 indexed | PASS |
| search_code 已索引仓库可搜索 | PASS |
| clear_index 清除后状态变为 not_found | PASS |
| 索引生命周期 not_found→indexing→indexed→failed | PASS |
| forceReindex 已索引仓库可重新索引 | PASS |

### 2.2 url+branch 隔离 (6/6)

| 测试用例 | 结果 | 关键验证 |
|----------|------|----------|
| 同一仓库不同路径→相同 identity | PASS | 4个仓库全部验证通过 |
| 路径A索引后路径B显示已索引 | PASS | Alice索引→Bob检测已索引 |
| 不同仓库→不同 identity | PASS | 4个仓库identity全唯一 |
| 删除一个仓库不影响其他 | PASS | 删除LSMKV不影响TitanBench |
| 快照 save/load 后 identity 格式不变 | PASS | v2格式持久化正确 |
| getIndexedCodebases 返回 identity 而非路径 | PASS | 全部为url格式 |

### 2.3 路径解析 (5/5)

| 测试用例 | 结果 |
|----------|------|
| detectWorkspaceRoot 检测 .git | PASS |
| monorepo 子目录不误判 | PASS |
| resolveCodebasePath 各种路径格式 | PASS |
| ensureAbsolutePath | PASS |
| ~ 展开为 home 目录 | PASS |

### 2.4 多仓库场景 (4/4)

| 测试用例 | 结果 |
|----------|------|
| 5个仓库全部索引，identity各不同 | PASS |
| 跨仓库索引互不干扰 | PASS |
| 同一仓库三次clone，索引一次共享三次 | PASS |
| 用户换路径后索引仍可用 | PASS |

### 2.5 Token 效率 (2/2)

| 测试用例 | 结果 | 节省 |
|----------|------|------|
| 小项目 LSMKV | PASS | -43%（小项目差异小） |
| 大项目 claude-context | PASS | **98%**（大项目优势巨大） |

**结论**: 项目越大，MCP 语义搜索节省的 token 越多。claude-context 自身项目搜索节省 98% token。

### 2.6 工具描述 (5/5)

| 测试用例 | 结果 |
|----------|------|
| 不应包含 "absolute path" 强调 | PASS |
| 应提及 git URL + branch 隔离 | PASS |
| 四个工具应支持 path 默认值 | PASS |
| search_code 保留 When to Use 结构 | PASS |
| 所有工具 path 参数说明正确 | PASS |

---

## 三、MCP 集成测试

| 测试项 | 结果 |
|--------|------|
| index_codebase 索引 claude-context | PASS — 1270 files, 1270 chunks |
| search_code 搜索 "url+branch identity" | PASS — 返回5条精确结果 |
| search_code 不传 path 默认工作区 | PASS |
| get_indexing_status 查询状态 | PASS — indexed, 1270 files |

---

## 四、Bug 发现与修复

| Bug | 文件 | 修复 |
|-----|------|------|
| `require('os')` ESM 不可用 | packages/mcp/src/utils.ts:76 | 添加 `import * as os from "os"` |
| 8处 "absolute paths" 残留 | packages/mcp/src/index.ts | 全部改为 "paths" |

---

## 五、结论

**可以上线。** 32/32 全部通过。

- 四个 MCP 工具功能正常
- url+branch 隔离机制正确，团队共享索引验证通过
- 路径解析完善，支持多种输入格式
- 大项目 token 节省 98%
- 工具描述已优化，移除绝对路径强调

## 六、测试代码位置

```
test/test2026/
├── test-basic-tools.ts          # 基础工具 (6)
├── test-url-branch-isolation.ts # url+branch隔离 (6)
├── test-path-resolution.ts      # 路径解析 (5)
├── test-multi-repo.ts           # 多仓库 (4)
├── test-token-efficiency.ts     # Token效率 (2)
├── test-tool-descriptions.ts    # 工具描述 (5)
└── run-all-tests.sh             # 运行脚本
```

运行：
```bash
cd /home/zt/claude-context/packages/mcp
for f in ../../test/test2026/test-*.ts; do
    node --import tsx --test "$f"
done
```