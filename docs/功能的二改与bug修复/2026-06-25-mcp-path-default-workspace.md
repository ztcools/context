# 2026-06-25 | MCP路径默认工作区 & 工具提示词优化

## 问题
- 工具描述强制要求绝对路径，LLM无法理解相对路径或工作区
- 用户未指定路径时无默认值，必须手动传入路径
- 所有工具的path参数都标记为required，不传就报错
- 索引前未检查向量数据库是否已存在相同url+branch的索引，可能重复索引

## 修改内容

**`packages/mcp/src/utils.ts`**
- 新增 `detectWorkspaceRoot()`：从cwd向上遍历，自动检测IDE工作区根目录（识别.git、package.json、.vscode、pnpm-workspace.yaml等标记）
- 新增 `resolveCodebasePath()`：统一路径解析，支持
  - `"."` / `"./"` / `"workspace"` → 自动检测工作区，检测不到则fallback到cwd
  - `"~"` / `"~/xxx"` → home目录
  - 绝对路径 → 原样返回
  - 相对路径 → 基于cwd解析

**`packages/mcp/src/index.ts`**
- 更新四个工具（index_codebase、search_code、clear_index、get_indexing_status）的path参数描述，明确支持绝对/相对/工作区路径
- 移除所有工具path参数的`required: ["path"]`，改为可选
- 所有path参数描述增加"Defaults to the current workspace if not provided"
- 更新index_codebase工具描述，明确path仅用于定位项目磁盘位置，索引身份由git url+branch决定，索引前会自动检查是否已存在

**`packages/mcp/src/handlers.ts`**
- 所有handler中`path`参数默认值改为`"."`，统一调用`resolveCodebasePath()`解析
- `handleIndexCodebase`：增加索引前基于url+branch的向量数据库预检查，已存在索引直接返回提示，除非force=true
  - 若Milvus中存在但本地快照缺失，自动从Milvus恢复快照
  - 不同本地路径指向同一仓库（同url+branch）时提示索引共享
- `handleClearIndex`：改为用codebaseIdentity匹配而非绝对路径

## 效果
- 用户说"帮我索引工作区"、"index this"、"search for auth"等省略路径的说法，LLM直接调用工具不需要反问路径
- 支持`"."`自动检测IDE工作区，Claude Code CLI场景下cwd就是项目目录，直接可用
- 同一仓库克隆到不同本地位置共享同一个索引（url+branch隔离），避免重复索引浪费资源
