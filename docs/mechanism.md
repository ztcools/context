# Claude Context MCP 机制说明书

## 一、索引机制

### 1.1 触发方式

| 触发方式 | 类型 | 说明 |
|----------|------|------|
| 用户手动触发 | 人工 | 用户说"索引这个项目"，Agent 调用 `index_codebase` |
| 后台定时同步 | 自动 | 每 5 分钟对已索引代码库做增量同步（默认，可配置） |
| 触发文件监听 | 自动 | IDE Write/Edit 操作后，钩子 touch `~/.context/.sync-trigger`，2 秒内触发即时增量同步 |

**总结：首次索引需人工触发，后续变更自动增量同步。**

### 1.2 索引类型

| 场景 | 类型 | 机制 |
|------|------|------|
| 首次索引 | 全量 | 遍历所有代码文件，生成向量索引 |
| 后台同步 | 增量 | Merkle DAG 树比较文件哈希，仅处理新增/修改/删除的文件 |
| force=true | 全量 | 强制重建索引，删除旧索引后重新全量 |
| 触发文件 | 增量 | 同后台同步，Merkle 树比较后增量更新 |

**结论：支持增量索引，非每次都全量。**

### 1.3 增量索引流程

```
用户 git pull 新代码
  │
  ├─ 方式 A: IDE Write 操作 → 钩子 touch .sync-trigger → 2秒内触发增量同步
  │
  └─ 方式 B: 等待后台定时同步（最多 5 分钟）
  │
  ↓
context.reindexByChange()
  │
  ├─ 1. 生成当前文件 Merkle DAG 树
  ├─ 2. 与上次快照比较（~/.context/merkle/*.json）
  ├─ 3. 分类：新增 / 修改 / 删除
  ├─ 4. 仅处理变更文件的向量
  └─ 5. 更新快照
```

### 1.4 关于 git push

本地 git push 后，**远端仓库变更不影响本地文件，不会触发增量索引**。需要 git pull 到本地后，才能自动同步。

---

## 二、隔离机制

### 2.1 标识方式

索引使用 `git远程URL + 分支名` 作为唯一标识，而非文件系统路径。

```
/home/alice/project → https://github.com/org/repo.git:main
/home/bob/project   → https://github.com/org/repo.git:main  ← 同一标识
```

### 2.2 实现路径

```
getRepoIdentity(path)
  ├─ git remote get-url origin  → 获取仓库 URL
  ├─ git rev-parse --abbrev-ref HEAD → 获取分支名
  └─ 返回 "url:branch"
```

### 2.3 隔离效果

| 场景 | 行为 |
|------|------|
| 同一仓库 clone 到不同路径 | 共享同一索引，不重复建立 |
| 同一仓库不同分支 | 各自独立索引 |
| 不同仓库 | 各自独立索引 |
| 团队成员 A 索引后，B 查询 | B 检测到 url+branch 已索引，无需重建 |

### 2.4 三层检查

当用户调用 `index_codebase` 时：

1. **Milvus 向量库检查**：`context.hasIndex()` 查 collection 是否存在
2. **快照一致性检查**：比较本地快照和 Milvus 状态，不一致时自动修复
3. **本地路径比较**：同一 identity 不同路径时，提示用户索引已共享

---

## 三、搜索机制

### 3.1 触发频率

`search_code` 的触发由 Agent(LLM) 决定，基于工具描述中的 `When to Use` 指引：

- 代码搜索：找函数、类、实现
- 上下文获取：修改前收集相关代码
- Bug 定位：找到问题代码段
- 代码审查：理解已有实现
- 重构：找到所有相关代码
- 功能开发：理解已有架构

**实际触发频率取决于 Agent 的判断**，不是每条消息都触发。当 Agent 需要理解项目结构时会调用。

### 3.2 搜索流程

```
Agent 调用 search_code(query, path)
  │
  ├─ 1. resolveCodebasePath(path) → 解析路径
  ├─ 2. getRepoIdentity(path) → url+branch 标识
  ├─ 3. context.search(query, path) → Milvus 向量搜索
  │     ├─ 将 query 转为向量
  │     ├─ 在对应 collection 中搜索 top-k 相似向量
  │     └─ 返回相关代码片段（含文件路径和行号）
  └─ 4. 返回结果给 Agent
```

### 3.3 相似度阈值

默认 `threshold=0.3`，只返回相似度高于此值的结果。值越大结果越精准但越少，值越小结果越多但噪音大。

---

## 四、快照管理

### 4.1 存储位置

```
~/.context/
├── mcp-codebase-snapshot.json   # 索引状态快照（v2 格式，key 为 url+branch）
├── merkle/                       # Merkle 树快照（用于增量检测）
│   └── {identity-hash}.json
├── mcp-sync.lock/               # 全局同步锁（防止多进程并发同步）
└── .sync-trigger                # 触发文件（即时同步信号）
```

### 4.2 快照内容

```json
{
  "formatVersion": "v2",
  "codebases": {
    "https://github.com/org/repo.git:main": {
      "status": "indexed",
      "localPath": "/home/alice/project",
      "indexedFiles": 1270,
      "totalChunks": 1270,
      "indexStatus": "completed",
      "lastUpdated": "2026-06-26T..."
    }
  }
}
```

### 4.3 生命周期

```
not_found → indexing → indexed
                ↓
            indexfailed
                ↓
          clear_index → not_found
```

---

## 五、云端同步

### 5.1 同步机制

- MCP 启动时，立即执行一次云端同步
- 后续每 5 分钟（默认）周期性同步
- 同步内容：基于 url+branch 标识比较本地快照和 Milvus 云端状态
- 不一致时自动修复：本地缺失 → 从 Milvus 恢复，Milvus 过时 → 清除本地快照

### 5.2 团队共享流程

```
Alice 的机器                      Bob 的机器
   │                                │
   ├─ index_codebase(repo)          │
   ├─ → 写入 Milvus                 │
   │                                ├─ MCP 启动
   │                                ├─ 云端同步检测到 repo 已索引
   │                                ├─ 自动恢复本地快照
   │                                └─ search_code 可直接使用
```

---

## 六、异常处理

| 场景 | 处理 |
|------|------|
| 代码库路径不存在 | 跳过同步，保持快照不变 |
| Milvus 连接失败 | 后台同步跳过，标记错误，下次重试 |
| 多进程并发同步 | 全局锁（~/.context/mcp-sync.lock），仅一个进程执行 |
| 锁过期（10分钟） | 自动回收过期锁，新进程接管 |
| 快照与 Milvus 不一致 | 自动修复，以 Milvus 为准 |
| 0/0+completed 毒化 | 启动时自动清理（Issue #295） |

---

## 七、环境变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CLAUDE_CONTEXT_BACKGROUND_SYNC` | `true` | 后台同步开关 |
| `CLAUDE_CONTEXT_SYNC_INTERVAL_MS` | `300000` | 同步间隔(ms) |
| `CLAUDE_CONTEXT_TRIGGER_WATCHER` | `true` | 即时触发同步开关 |
| `CLAUDE_CONTEXT_SYNC_LOCK_STALE_MS` | `600000` | 锁过期时间(ms) |