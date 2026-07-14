---
description: Seeway · 语义 + 调用图检索代码库
argument-hint: "<自然语言查询>（在当前工作区检索）"
allowed-tools: mcp__claude-context__search
---
调用 `mcp__claude-context__search` 工具检索代码库。

- query 参数：$ARGUMENTS
- path **省略**（默认当前工作区）。若查询里明确带了某个仓库路径，则把该路径作为 path、其余作为 query。
- 拿到结果后：优先用命中的 `file:line` 精确定位，**只 Read 真正需要的区间**，避免整文件通读；结果不理想就换更聚焦的 query 再搜一次。
- 若提示未索引，提示用户先执行 `/seeway-index`。
