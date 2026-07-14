---
description: Seeway · 索引代码库（向量 + 知识图谱），一次建好
argument-hint: "[仓库相对/绝对路径，缺省为当前工作区]"
allowed-tools: mcp__claude-context__index
---
调用 `mcp__claude-context__index` 工具为代码库建立索引（向量 + 图，一次调用全搞定）。

- path 参数：$ARGUMENTS
- 若上面为空，则**省略 path**（默认当前工作区，不要传空字符串）。
- 索引是一次性操作，已索引会自动跳过；如需重建可在同一命令后追加 `force`。
- 完成后用一两句话汇报：索引到的文件/片段数，以及图索引是否成功。
