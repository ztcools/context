---
description: Seeway · 查看索引状态（向量 + 图）
argument-hint: "[仓库相对/绝对路径，缺省为当前工作区]"
allowed-tools: mcp__claude-context__status
---
调用 `mcp__claude-context__status` 工具查看代码库索引状态。

- path 参数：$ARGUMENTS（为空则省略，默认当前工作区）。
- 汇报：是否已索引、文件/片段数量、图索引状态；未索引时提示可用 `/seeway-index` 建立。
