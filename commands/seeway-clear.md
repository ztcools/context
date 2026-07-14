---
description: Seeway · 清除代码库索引（向量 + 图）
argument-hint: "[仓库相对/绝对路径，缺省为当前工作区]"
allowed-tools: mcp__claude-context__clear
---
调用 `mcp__claude-context__clear` 工具清除代码库的索引（向量 + 图）。

- path 参数：$ARGUMENTS（为空则省略，默认当前工作区）。
- 这是破坏性操作，但索引可重建。执行前先用一句话说明将要清除的目标路径，然后直接调用。
- 完成后汇报清除结果；如需重新使用，提示可用 `/seeway-index` 重建。
