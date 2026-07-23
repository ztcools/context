# claude-context — 项目开发指南

> 代码智能索引工具，为 Claude Code 提供语义搜索 + 知识图谱双引擎。

## 项目概述

claude-context 是一套代码索引与检索系统，核心价值：
1. **语义搜索**：按意图搜代码（稠密向量 + BM25 混合检索，RRF 融合排序）
2. **知识图谱**：tree-sitter AST 解析 → 构建调用图（CALLS/IMPORTS/INHERITS/HTTP_CALLS…），提供调用链追踪、死代码标记、架构分析
3. **开发者私有索引**：每人独立的 per-branch collection，Merkle 内容追踪代替 git commit diff，对 reset/rebase/stash 等操作免疫
4. **MCP 集成**：通过 MCP 协议暴露 `index/search/clear/status` 四个工具，Claude Code 一键接入

发布为 MCP server，安装后 Claude Code 即可在**任意项目**中 `index` → `search`，无需该项目的开发依赖。

## 索引架构设计（团队开发）

### 核心原则：索引跟踪文件内容，不跟踪 git 历史

```
┌──────────────────────────────────────────────────────────┐
│  Milvus (共享)                                            │
│  ├── hcc_repo_main            ← 服务端定时索引（只读）      │
│  ├── hcc_repo_featA_alice     ← Alice 在 feature/A 的索引  │
│  ├── hcc_repo_featA_bob       ← Bob 在 feature/A 的索引    │
│  ├── hcc_repo_featB_alice     ← Alice 在 feature/B 的索引  │
│  └── embedding_cache_xxx      ← 全局共享向量缓存            │
│                                                           │
│  本地 (~/.claude-context/merkle/)                          │
│  └── <identity>.json          ← 每人每分支独立 Merkle 快照  │
└──────────────────────────────────────────────────────────┘
```

### 索引身份 = `gitRemote:branch:devFingerprint`

开发者指纹（[dev-fingerprint.ts](packages/core/src/utils/dev-fingerprint.ts)），**零配置自动生效**：

```
1. CLAUDE_CONTEXT_DEV_ID env       （可选覆盖，团队统一标识时使用）
2. git config user.email           （默认，自动获取 — git 团队开发必须配置）
3. hostname                        （兜底）
4. /etc/machine-id                 （终极兜底）
```

### 索引流程（Merkle 内容追踪）

```
1. 扫描工作树 → 计算每个文件的 SHA256 内容哈希
2. 对比上次 Merkle 快照 → 检测增/删/改
3. 变化文件 → 切 chunk → 查 embedding cache → 嵌入 miss 部分
4. 写入 dev 个人 collection (Milvus)
5. 保存新的 Merkle 快照（本地文件）
```

**关键**：不依赖 git commit SHA。git reset/rebase/merge 导致的文件变化被 Merkle 自然检测，内容相同的文件零成本跳过。

### 搜索流程（dev ⊕ root 两层）

```
search 时：
  layer 1: dev collection (hcc_repo_branch_devId)  ← 完整的个人工作树快照
  layer 2: root collection (hcc_repo_main)          ← fallback（dev 未索引时）

同一文件在 dev 和 root 中都有时，dev 版本优先（更高层覆盖底层）。
```

### 团队场景行为

| 场景 | 行为 |
|------|------|
| git reset --hard | 文件变化→Merkle 检测→重索引变化的文件（cache 命中） |
| git rebase | 代码不变则零成本；冲突解决后增量索引 |
| git merge | 新文件被索引，未变文件跳过 |
| git stash / pop | Merkle 检测变化→增量索引（cache 100% 命中） |
| 两人同分支改不同文件 | 各自写各自 collection，互不干扰 |
| 未提交修改 | 索引个人 collection，不影响其他开发者 |
| 切换分支后切回 | Merkle 匹配上次快照→零成本 |
| force push 后同步 | Merkle 检测文件变化→增量索引 |

## 架构总览

```
claude-context (monorepo, pnpm workspace)
├── packages/core          @seeway/claude-context-core     # 核心索引引擎
├── packages/graph         @seeway/claude-context-graph    # 知识图谱引擎
├── packages/mcp           @seeway/claude-context-mcp      # MCP 服务端（对外入口）
├── packages/vscode-extension  semanticcodesearch         # VS Code 插件
├── packages/chrome-extension  @seeway/claude-context-chrome-extension
└── packages/git-index-service  @seeway/claude-context-git-index-service  # 定时云端索引
```

### 依赖关系

```
mcp ──→ core, graph     （mcp 是唯一面向用户的包，聚合 core + graph）
vscode-extension ──→ core
chrome-extension ──→ core
git-index-service ──→ core
graph ──→ 独立（better-sqlite3 + tree-sitter*）
core ──→ 独立（Milvus SDK + embedding providers）
```

## 关键数据流

### 索引流程 (index)
```
开发者工作树
  → FileSynchronizer (Merkle 内容哈希对比) → 增/删/改文件列表
  → Splitter (AST 语法感知 / LangChain 字符) → CodeChunk[]
  → Embedding API (OpenAI/VoyageAI/Gemini/Ollama) → 向量
    → 优先查 embedding_cache (全局共享，内容哈希匹配)
  → Milvus insert to dev collection (hybrid: dense + sparse/BM25)
  → 保存本地 Merkle 快照
  → GraphExtractor (tree-sitter Worker Threads) 3阶段:
    Phase 1: Worker 并行解析 AST → InMemoryGraphBuffer
    Phase 2: FunctionRegistry 解析跨文件 CALLS
    Phase 3: 批量写入 SQLite（每 10K 行 yield 事件循环）
```

### 搜索流程 (search)
```
用户查询
  → Embedding → 查询向量
  → dev collection (优先) → searchWithLayers
     root collection (fallback，dev 未索引时)
  → Milvus hybridSearch (dense + sparse, RRF 融合)
  → GraphSearcher (SQLite FTS + 调用图上下文)
  → 结果合并：dev 结果优先 + root 结果补充
  → 片段 + 调用者/被调用者/调用链/架构摘要
```

### 索引模式选择 (syncIndexByMerkle)
```
if 首次索引（无 Merkle 快照）:
  → 所有文件都是 "new" → 全量索引到 dev collection
elif Merkle 对比无变化:
  → up-to-date，零操作
else:
  → 只处理增/删/改文件 → 增量索引到 dev collection
```

## 技术栈

| 层面 | 技术 |
|------|------|
| 语言 | TypeScript (ES2020, commonjs) |
| 运行时 | Node.js ≥ 20 |
| 包管理 | pnpm ≥ 10 (workspace monorepo) |
| 向量数据库 | Milvus (支持 hybrid: dense + sparse/BM25) |
| 图数据库 | SQLite (better-sqlite3, FTS5 全文搜索) |
| AST 解析 | tree-sitter (JS/TS/Python/Java/C++/Go/Rust/C#/Scala) |
| Embedding | OpenAI / VoyageAI / Gemini / Ollama / OpenRouter |
| MCP 协议 | @modelcontextprotocol/sdk |
| VS Code | Webview + Webpack 打包 |

## 核心模块速查

### core — src/context.ts (核心类, ~2500行)
- `Context` 类：一切的总入口。构造函数接受 `embedding` + `vectorDatabase` + `splitter`
- `indexCodebase()` — 全量索引（服务端使用）
- `syncIndexByGit()` — Git 增量索引（**服务端 git-index-service 使用**，基于 commit diff）
- `syncIndexByMerkle()` — **开发者 Merkle 索引**（MCP 端使用，内容哈希追踪，对 reset/rebase 免疫）
- `semanticSearch()` — 多层 hybrid 搜索，跨 layer global RRF 融合
- `searchWithLayers()` — **显式层搜索**，调用方提供 collection 列表（不依赖 CommitIndexState）
- `getDevCollectionName()` / `getRootCollectionName()` — dev-aware 集合命名
- `processChunkBatch()` — 嵌入缓存：先查 Milvus 缓存再调 API
- `collectionNamePattern`: `hcc_<repo>_<md5hash>` （identity = `gitUrl:branch:devFingerprint`）

关键环境变量（通过 `envManager` 读取）：
- `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSION`
- `MILVUS_ADDRESS`, `MILVUS_TOKEN`
- `HYBRID_MODE` (默认 true), `EMBEDDING_BATCH_SIZE` (默认 100)
- `EMBEDDING_CACHE_ENABLED` (默认 true)
- `CUSTOM_EXTENSIONS`, `CUSTOM_IGNORE_PATTERNS`
- `CLAUDE_CONTEXT_DEV_ID` — **可选**，显式设置开发者身份（未设置时自动使用 git email）
- `GIT_ROOT_BRANCHES` — root 分支名（默认 main,master，仅服务端使用）
- `GIT_INCREMENTAL_ENABLED`, `GIT_LAYERED_ENABLED` — 服务端索引开关

### core/src/splitter/ — 代码分割
- `AstCodeSplitter` — tree-sitter 语法感知（按函数/类边界切分），支持 10 种语言，不支持的语言自动 fallback 到 LangChain
- `langchain-splitter.ts` — 字符级 RecursiveCharacterTextSplitter

### core/src/embedding/ — Embedding 提供商
- 统一接口 `Embedding`，实现：`OpenAIEmbedding`, `VoyageAIEmbedding`, `GeminiEmbedding`, `OllamaEmbedding`

### core/src/vectordb/ — 向量数据库
- `MilvusVectorDatabase` — dense + sparse (BM25) hybrid 搜索
- `milvus-restful-vectordb.ts` — RESTful API 版本

### core/src/sync/ — 文件同步
- `FileSynchronizer` — 基于 Merkle 树的文件变更检测，支持 dev identity override
  - 每开发者每分支独立 Merkle 快照（`~/.claude-context/merkle/<identity-hash>.json`）
- `MerkleTree` — 内容哈希 Merkle 树实现

### core/src/cache/ — 嵌入缓存
- `EmbeddingCache` 接口 → `MilvusEmbeddingCache` / `NoopEmbeddingCache`
- 内容哈希去重：相同内容的 chunk 不重复调 embedding API

### core/src/index-state/ — 提交级索引状态
- `CommitIndexState` — 记录每个 identity(branch) 的 last-indexed-commit（仅服务端使用）
- 开发者端不再写入 CommitIndexState，改用本地 Merkle 快照

### core/src/utils/ — 工具
- `git-identity.ts` — `getRepoIdentity()`: `gitRemote:branch`
- `dev-fingerprint.ts` — **开发者身份标识**：`getDevFingerprint()` / `getDevRepoIdentity()` / `getBranchIdentity()`
  - 三级解析：`CLAUDE_CONTEXT_DEV_ID` env → `git config user.email` → `hostname`
  - 缓存到 `~/.claude-context/dev-id`，持久稳定
- `git-history.ts` — git 历史操作：diff changed files、commit 查询（服务端使用）
- `glob-matcher.ts` — glob 模式匹配
- `env-manager.ts` — 环境变量管理（缓存 + 热更新）

### graph — 知识图谱
- `SqliteGraphStore` — 带 FTS5 全文索引的 SQLite 存储
- `GraphExtractor` — tree-sitter AST 提取节点和边
- `CallTracer` — 调用链追踪（BFS），支持 inbound/outbound/both
- `GraphSearcher` — BM25+FTS 图搜索
- `ArchitectureAnalyzer` — 架构分析：入口点检测、模块聚类
- `FunctionRegistry` — O(1) 函数查找，用于跨文件调用解析
- `parse-worker.ts` — Worker Thread 脚本，并行 AST 解析
- `InMemoryGraphBuffer` — Phase 1 的内存图缓冲区

### mcp — MCP 服务
- `src/index.ts` — 入口，`ContextMcpServer` 类
  - 关键：`console.log` 重定向到 stderr，stdout 只走 MCP JSON 协议
- `src/handlers.ts` — 4 个 MCP Tool handler（全部 dev-aware）：
  - `handleIndex` — 使用 `syncIndexByMerkle` 索引到 dev collection
  - `handleSearchCode` — 使用 `searchWithLayers` 搜 dev + root 两层
  - `handleClearIndex` — 清除 dev collection + Merkle 快照
  - `handleStatus` — 检查 dev + root 两层索引状态
- `src/graph-handlers.ts` — 图操作 handler：`handleIndexRepository`（3 阶段）、`handleSearchGraph`、`handleTracePath`、`handleGetArchitecture`等
- `src/sync.ts` — 后台自动同步（默认每 5 分钟，使用 `syncIndexByMerkle`）
- `src/config.ts` — MCP 配置解析（环境变量 → `ContextMcpConfig`）
- `src/snapshot.ts` — 代码库快照管理（v2 格式）

### git-index-service — 定时云端索引
- 从 GitLab/配置文件获取 repo 列表 → clone → index → 定期重索引
- **只索引 root 分支**（main/master），使用 `syncIndexByGit`（git commit diff）
- 开发者不写 root collection，只读取
- 支持 SSH Key、HTTP 管理 API、热配置

## 开发命令

```bash
# 安装依赖（仅 MCP 子图，排除 vscode/chrome 的原生依赖）
pnpm install --filter @seeway/claude-context-mcp...

# 构建
pnpm build:core && pnpm build:graph && pnpm build:mcp

# 或全量构建
pnpm build

# 类型检查
pnpm typecheck

# lint（eslint flat config）
pnpm lint
pnpm lint:fix

# 运行 MCP 服务 (开发)
cd packages/mcp && pnpm dev

# 测试
pnpm --filter @seeway/claude-context-core test
pnpm --filter @seeway/claude-context-graph test
pnpm --filter @seeway/claude-context-mcp test
```

## MCP 工具接口（对外暴露）

| 工具 | 参数 | 说明 |
|------|------|------|
| `index` | path?, force?, splitter?, customExtensions?, ignorePatterns? | 索引代码库（向量+图谱） |
| `search` | query*, path?, limit?, extensionFilter? | 语义+图谱搜索 |
| `clear` | path? | 清除向量和图索引 |
| `status` | path? | 索引状态查询 |

## 安装与部署

- `install.sh` — 一键安装到 `~/.claude-context`，配置 MCP + 上下文策略
- 默认向量后端指向公司服务器 (10.50.4.149: Milvus :19530, Ollama :11435)
- 可通过环境变量覆盖：`OLLAMA_HOST`, `MILVUS_ADDRESS`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSION`

## 代码约定

- TypeScript commonjs 模块（`packages/mcp` 和 `git-index-service` 例外使用 ESM）
- 命名风格：camelCase 变量/函数，PascalCase 类/接口
- 核心类 `Context` 是状态ful 的，通过构造函数注入依赖
- 环境变量统一通过 `envManager` 访问（不做 `process.env` 直读）
- 所有 console 输出带 `[Context]`, `[GraphIndex]`, `[SYNC-DEBUG]` 等前缀
- Git 操作优先用 `git` CLI（execSync），失败有 fallback
- repo identity 格式：
  - 分支 identity：`<git-remote-url>:<branch>`（用于 root collection、graph）
  - 开发者 identity：`<git-remote-url>:<branch>:<devFingerprint>`（用于 dev collection）

## 分支说明

- `main` — 主分支，所有开发直接在此进行

## 最近开发重点（2026-07）

- **Dev-aware 索引架构**：开发者私有索引 + Merkle 内容追踪，对 git reset/rebase/stash 免疫
- **DevFingerprint**：稳定开发者身份标识（env/git-email/hostname 三级）
- **embedding cache**：全局共享向量缓存，跨开发者/跨分支复用
- 性能优化：Worker Threads 并行解析、批量 SQL、事件循环不阻塞
- 知识图谱自动构建（首次 search 触发）
- MCP 配置幂等安装
