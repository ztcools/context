# Claude Context MCP 使用教程

## 前置条件

MCP 已配置好，Attu 后端已部署，此处不涉及部署步骤。

---

## 四个工具

配置完成后，IDE 会识别到 4 个 MCP 工具：

| 工具 | 用途 |
|------|------|
| `index_codebase` | 为项目建立语义索引 |
| `search_code` | 语义搜索代码库 |
| `get_indexing_status` | 查看索引状态 |
| `clear_index` | 清除索引 |

---

## 实际使用

### 1. 索引项目

在对话中直接说：

> "索引当前项目"
> "index this project"
> "帮我把 /path/to/project 索引一下"

Agent 会自动调用 `index_codebase`。同一仓库(url+branch)只需索引一次，团队成员共享索引。

### 2. 搜索代码

在对话中直接说：

> "这个项目的认证逻辑是怎么实现的？"
> "帮我找到所有数据库连接相关的代码"
> "这个 bug 可能出在哪里？"

Agent 会自动调用 `search_code` 进行语义搜索，返回相关代码片段。

### 3. 查看索引状态

> "当前项目索引状态是什么？"
> "看看索引进度"

Agent 调用 `get_indexing_status`。

### 4. 清除索引

> "清除当前项目的索引"
> "重新索引这个项目"

Agent 调用 `clear_index` 或 `index_codebase`（带 force=true）。

---

## 关键行为

- **不传路径默认为当前工作区**：对话中直接说"索引当前项目"即可，无需指定路径
- **url+branch 隔离**：同一仓库不同 clone 路径共享索引，不重复建立
- **团队共享**：A 成员索引后，B 成员自动发现已索引，无需重复
- **搜索自动降级**：未索引的项目使用 `search_code` 会报错，提示先索引

---

## 环境变量（可选）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CLAUDE_CONTEXT_BACKGROUND_SYNC` | 是否启用后台自动同步 | `true` |
| `CLAUDE_CONTEXT_SYNC_INTERVAL_MS` | 后台同步间隔(ms) | `300000` (5分钟) |
| `CLAUDE_CONTEXT_TRIGGER_WATCHER` | 是否启用即时触发同步 | `true` |