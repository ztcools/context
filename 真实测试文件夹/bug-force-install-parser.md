仓库地址：https://github.com/duckdb/duckdb.git
git checkout 10d6a34313

什么问题：`FORCE INSTALL` 命令在 PEG 解析器中被错误处理——`FORCE` 关键字被解析器丢弃，导致 `FORCE INSTALL extension_name` 被当作普通的 `INSTALL` 处理。当用户尝试强制安装一个已经从不同源安装过的扩展时，会收到一个令人困惑的错误提示，告诉用户重新使用 `FORCE INSTALL` 来安装——但实际上用户已经使用了 `FORCE` 关键字。

MCP优势：向量索引快速定位 PEG 解析器中 INSTALL 语句的处理逻辑

提示词：
你是 DuckDB 的解析器开发者。用户反馈了一个 bug：`FORCE INSTALL` 命令不生效。

用户在终端执行：
```sql
FORCE INSTALL iceberg;
```
然后收到错误说 "extension already installed from a different source, use FORCE INSTALL to reinstall"，但这明明就是 `FORCE INSTALL`。

你需要：
1. 找到 PEG 解析器中处理 INSTALL 语句的 grammar 规则和 transformer 代码
2. 理解 `FORCE` 关键字在解析过程中是如何被处理的
3. 定位为什么 `FORCE` 关键字被丢弃了
4. 修复 transformer 代码，正确区分 `INSTALL` 和 `FORCE INSTALL`
5. 添加测试用例验证修复

提示：从 `src/parser/peg/grammar/` 中找到 LOAD/INSTALL 相关的 grammar 规则，然后追踪到 `src/parser/peg/transformer/` 中的转换逻辑。