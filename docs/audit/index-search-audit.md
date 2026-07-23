# 索引与搜索流程 — 审计报告

> 生成时间: 2026-07-23
> 审查范围: `packages/core`, `packages/mcp`, `packages/graph`

## 🔴 严重 Bug

### B1. `syncIndexByMerkle` monkey-patching `getRepoIdentityCached` — 并发不安全

**文件**: [context.ts:1305-1328](../../packages/core/src/context.ts#L1305-L1328)

```typescript
(this as any).getRepoIdentityCached = patchedGetRepoIdentityCached;
// ... await processFileList() ...  ← await 让出控制权
(this as any).getRepoIdentityCached = origCached;
```

**问题**: 在 `await` 期间，后台 auto-sync (每 5 分钟) 或另一个 `index` 请求会读取被篡改的函数，写入错误的 collection。

**修复方向**: 给 `processFileList` 添加显式 `collectionName` 参数，替换 monkey-patching。

---

### B2. Dev-aware 搜索只用单层 — 与 CLAUDE.md 架构文档矛盾

**文件**: [handlers.ts:892-913](../../packages/mcp/src/handlers.ts#L892-L913)

```typescript
if (devExists) {
    searchResults = searchWithLayers([{ collectionName: devCollectionName }], ...);
    // ↑ 只搜 dev — dev 只索引了自己改的文件，其他文件搜不到
} else if (rootExists) {
    searchResults = searchWithLayers([{ collectionName: rootCollectionName }], ...);
    // ↑ 只搜 root — dev 索引被忽略
}
```

**问题**: [CLAUDE.md](../../CLAUDE.md) 描述的是 "layer 1: dev → layer 2: root (fallback)" 两层架构，实际是二选一。

**后果**:
- 开发者增量索引后，search 只能看到 dev collection 中自己改过的文件
- 看不到 main 分支上队友索引的其余代码

**修复方向**: 始终传两层：
```typescript
searchWithLayers([
    { collectionName: devCol },
    { collectionName: rootCol, mask: devChangedFiles },
], query, topK);
```

---

### B3. 进程崩溃导致"幽灵 up-to-date"：空 Merkle 快照过早保存

**文件**: [synchronizer.ts:330-340](../../packages/core/src/sync/synchronizer.ts#L330-L340)

```
loadSnapshot ENOENT → 初始化空 Map → 立即 saveSnapshot（空文件）
→ 索引开始 → 进程崩溃（未完成）
→ 下次对比：当前哈希 vs 空快照 = "无变化" → up-to-date
→ 实际：Milvus 中零数据
```

**修复方向**:
- 快照仅在索引成功完成后保存
- 或在快照中加 `status: "dirty"` 标记位区分"正在索引"和"已索引无变化"

---

### B4. `loadedCollections` 缓存永不失效 — Milvus 重启后所有搜索失败

**文件**: [milvus-vectordb.ts:85-94](../../packages/core/src/vectordb/milvus-vectordb.ts#L85-L94)

```typescript
private loadedCollections: Set<string> = new Set();

protected async ensureLoaded(collectionName: string): Promise<void> {
    if (this.loadedCollections.has(collectionName)) return;  // ← 短路, 永不验证
    // ...
    this.loadedCollections.add(collectionName);
}
```

**问题**: `Set<string>` 缓存已加载的 collection 名。Milvus 重启后 collection 被卸载，但缓存仍认为已加载。

**后果**: 后续所有 `search`/`query` 都因 `LoadNotExist` 失败，直到 MCP server 重启。

**修复方向**: TTL 过期或定期心跳检测；或在 `search` 失败时自动清除缓存并重试。

---

### B5. Embedding 缓存写入失败静默吞没 — 损坏不可见

**文件**: [embedding-cache.ts:158-161](../../packages/core/src/cache/embedding-cache.ts#L158-L161)

```
维度不匹配/collection 缺失  →  "non-fatal" warning
新向量未缓存                 →  索引成功完成
下次重索引                   →  仍需重做 embedding（无缓存命中）
```

**修复方向**: 区分致命错误（维度不匹配→抛出）与可重试错误（并发冲突→重试）。

---

## 🟡 中等问题

### M1. 全局无条件跳过所有 dotfiles/dotdirs

**文件**: [synchronizer.ts:173-175](../../packages/core/src/sync/synchronizer.ts#L173-L175)
+ [context.ts:2357](../../packages/core/src/context.ts#L2357)

```typescript
// FileSynchronizer.shouldIgnore:
if (pathParts.some(part => part.startsWith('.'))) return true;

// Context.matchesIgnorePattern:
if (relativePath.split(path.sep).some(part => part.startsWith('.'))) return true;
```

**问题**: `.github/workflows/ci.yml`, `.eslintrc.js`, `.env.example` 等重要配置文件永远不可索引，且无配置出口。

**修复方向**: 至少允许 `.github/`, `.circleci/` 等已知 CI 目录被索引，或提供 pattern 覆盖机制。

---

### M2. 双重去重逻辑不一致

- `searchWithLayers` → `deduplicateResults()`: **>50% 行重叠**才去重
- `handleSearchCode` 手动去重: **任何行交集**就去重

**问题**: 同一批结果经过两层不同标准，合法 chunk（50% 以下重叠）被第一层保留但被第二层误杀。

**修复方向**: 统一为一层去重，使用 >50% 重叠阈值。

---

### M3. `envManager` 热路径磁盘 I/O

**文件**: [env-manager.ts](../../packages/core/src/utils/env-manager.ts)

**问题**: `get()` miss 后每次 `readFileSync` 扫描 `.env`。`getIsHybrid()` 每次 search 都调用 → 如果 `HYBRID_MODE` 只在 `.env` 中定义，每次搜索触发一次磁盘读取。

**修复方向**: 初始化时一次性加载 `.env` 文件到内存。

---

### M4. `threshold` 参数在 hybrid 模式下永远不生效

**文件**: [context.ts:1467-1494](../../packages/core/src/context.ts#L1467-L1494)

**问题**: `HYBRID_MODE` 默认 `true`，此时走 hybrid/RRF 路径。`threshold` 过滤只在 dense-only 路径生效 → 低分结果永远无法被过滤。

**修复方向**: 在 RRF 结果上也应用阈值或 score ratio 过滤。

---

### M5. `processFileList` 的 abort 检查仅在文件边界

**文件**: [context.ts:1885](../../packages/core/src/context.ts#L1885)

**问题**: 大文件有 10000 个 chunk、EMBEDDING_BATCH_SIZE=100 时，需要 100 次 async embedding 调用才能走到下一个 abort 检查点。

**后果**: `clear_index` 操作可能需要等待数十秒才能真正生效。

**修复方向**: 在每个 batch 处理之前也检查 abort。

---

### M6. Dev fingerprint slug 碰撞风险

**文件**: [dev-fingerprint.ts:36](../../packages/core/src/utils/dev-fingerprint.ts#L36)

**问题**: `slugify` 截断到 12 字符，`alice.johnson@company.com` 和 `alice.johnson-smith@company.com` 都变成 `alice_johnso` → 两个开发者共享 collection。

**修复方向**: 追加短哈希后缀（如 md5 后 4 位）防止碰撞。

---

### M7. 后台 sync 全局锁用目录作互斥 — 进程崩溃残留

**文件**: [sync.ts:98-99](../../packages/mcp/src/sync.ts#L98-L99)

**问题**: `fs.mkdirSync(lockPath)` 原子锁。进程崩溃后需等 10 分钟 stale 超时（`DEFAULT_SYNC_LOCK_STALE_MS`）。

**修复方向**: 使用 `proper-lockfile` 或 `flock` — 进程退出时自动释放。

---

### M8. 非 `EmbeddingError` 的批量失败 → chunk 永久丢弃

**文件**: [context.ts:1910-1927](../../packages/core/src/context.ts#L1910-L1927)

```
非 EmbeddingError 的失败 → chunk buffer 清空 + 仅 warning
→ Merkle 快照保存成功 → 下次不重试 → chunks 永久丢失
```

**修复方向**: 恢复 chunk buffer 或标记该批次为待重试。

---

### M9. REST backend 缺少 `sparseSearch` → 跨层 global RRF 不可用

**文件**: [milvus-restful-vectordb.ts](../../packages/core/src/vectordb/milvus-restful-vectordb.ts)

**问题**: REST 实现没有 `sparseSearch()` 方法，跨层搜索降级为 per-layer simple score-merge。

**修复方向**: 实现 REST 的 sparseSearch。

---

### M10. SIGINT/SIGTERM 不释放全局锁、不关闭 graph store

**文件**: [index.ts:279-288](../../packages/mcp/src/index.ts#L279-L288)

**问题**: 直接 `process.exit(0)` → 锁目录残留 → 新 MCP 实例无法获取锁 10 分钟。

**修复方向**: 在 shutdown handler 中调用 `syncManager.stopBackgroundSync()`, `graphStore.close()`, 释放全局锁。

---

### M11. Graph 单线程同步 SQLite 阻塞搜索

**文件**: [graph-store.ts](../../packages/graph/src/graph-store.ts)

**问题**: `better-sqlite3` 同步操作，后台 graph 构建时阻塞搜索的图增强查询。

**修复方向**: 使用只读副本连接（WAL 模式支持）。

---

### M12. `queryCollectionStats` — chunk count 作为 file count 上报

**文件**: [handlers.ts:96-101](../../packages/mcp/src/handlers.ts#L96-L101)

**问题**: 快照恢复时用 `rowCount`（chunk 数量，通常是文件数的 10-100 倍）同时填写 `indexedFiles` 和 `totalChunks`。

**修复方向**: 添加独立的元数据查询或字段区分。

---

## 🟢 优化建议

| # | 问题 | 位置 | 方案 |
|---|------|------|------|
| O1 | Embedding API 无重试机制 | [context.ts:2037](../../packages/core/src/context.ts#L2037) | 指数退避重试（至少 3 次）+ 熔断器 |
| O2 | 搜索 query 嵌入无缓存 | `handleSearchCode` | LRU 缓存 (TTL=5min, key=query 文本) |
| O3 | `deleteFileChunks` 逐文件串行 | [context.ts:1377-1393](../../packages/core/src/context.ts#L1377-L1393) | 收集所有文件 ID 后批量 `delete` |
| O4 | `MerkleDAG` 构建完全冗余 | [synchronizer.ts:210-230](../../packages/core/src/sync/synchronizer.ts#L210-L230) | 根节点等价于对整个 Map 哈希，可简化为直接比较 Map |
| O5 | RRF k=100 硬编码 5 处 | 多个文件 | 环境变量 `RRF_K` 统一配置 |
| O6 | `CHUNK_LIMIT=450000` 硬编码 | [context.ts:1873](../../packages/core/src/context.ts#L1873) | 环境变量可配置 |
| O7 | `semanticSearch` 与 `searchWithLayers` 重复逻辑 | [context.ts](../../packages/core/src/context.ts) | 抽取公共的 layer-search-and-merge |
| O8 | `git ls-files` 命令行可能超长 | [synchronizer.ts:86-91](../../packages/core/src/sync/synchronizer.ts#L86-L91) | JS 侧过滤扩展名 |
| O9 | `hashFile` 整个文件读入内存 | [synchronizer.ts:73](../../packages/core/src/sync/synchronizer.ts#L73) | 流式读取 (streaming hash) |
| O10 | `.env` 解析不支持标准语法 | `env-manager.ts` | 支持引号/注释/export 前缀 |
| O11 | `MerkleDAG.compare` 不报告 modified | [merkle.ts:95-103](../../packages/core/src/sync/merkle.ts#L95-L103) | DAG compare 只返回 added/removed，modified 在 file-level compare 补充 |

---

## 🔵 架构建议

### 1. 实现真正的 dev ⊕ root 两层搜索

当前 `handleSearchCode` 是二选一。应改为始终搜两层，root 层用 `mask` 排除 dev 已覆盖的文件。

### 2. LanceDB 替代本地 Milvus 评估

对于"开发者本地索引"场景，LanceDB 是嵌入式引擎（无服务端），dev collection 可存为本地文件，零运维。root collection 仍保留 Milvus。

### 3. 事务性边界

Merkle 快照应在所有 chunk 成功写入 Milvus 后保存。加 `status: "indexing"` 标记位区分"正在索引"和"已索引无变化"。

### 4. Graph SQLite → 连接池或读副本

当前单连接同步 SQLite 在后台构建时阻塞搜索的图增强查询。可使用只读副本连接（WAL 模式支持）或迁移到异步 SQLite。

### 5. Embedding 层面添加重试 + 熔断

添加指数退避重试（3次）+ 熔断器（连续失败 N 次后暂停），避免临时网络问题导致全量重索引。

---

## 📊 误报分析

以下为 Agent 提出的、但经验证不成立或已处理的发现：

| 发现 | 说明 |
|------|------|
| `addOverlap` 修改 startLine → chunk ID 与 deleteFileChunks 不匹配 | `deleteFileChunks` 按 `relativePath` 删所有 chunk，不依赖 chunk ID |
| `splitLargeChunk` 产生的 endLine 不正确 | `chunk.metadata.startLine + i` 中 `startLine` 是 tree-sitter 给出的文件级行号，增量正确 |
| REST `checkCollectionLimit` 字段命名 `name` vs `fieldName` | 该功能已被注释掉不启用 |
| `enrichWithGraphContextDeep` 非空断言 | 调用方已有 `if (this.graphToolHandlers)` 守卫 |

---

## 🎯 修复优先级

| 优先级 | 编号 | 问题 | 修复难度 |
|--------|------|------|----------|
| 🔴 P0 | B1 | syncIndexByMerkle monkey-patching 并发不安全 | 中 |
| 🔴 P0 | B2 | 搜索单层而非两层 | 低 |
| 🔴 P0 | B3 | 空快照幽灵 up-to-date | 低 |
| 🔴 P1 | B4 | loadedCollections 永不过期 | 低 |
| 🔴 P1 | B5 | Embedding 缓存失败静默吞没 | 低 |
| 🟡 P2 | M1 | 全局跳过 dotfiles | 低 |
| 🟡 P2 | M3 | envManager 热路径 I/O | 低 |
| 🟡 P2 | M4 | threshold 在 hybrid 模式下不生效 | 低 |
| 🟡 P2 | M2 | 双重去重不一致 | 低 |
| 🟡 P2 | M10 | 退出不释放锁 | 低 |
| 🟡 P2 | M8 | Chunk 批量失败永久丢失 | 中 |
| 🟡 P2 | M5 | abort 检查仅在文件边界 | 中 |
| 🟡 P2 | M6 | Dev fingerprint slug 碰撞 | 低 |
| 🟢 P3 | O1-O11 | 各项优化 | 低-中 |
