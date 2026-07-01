git checkout 0103fc59f2

什么问题：DuckDB 需要支持 SQL 标准中的 `FETCH FIRST/NEXT ... ROWS ONLY` 语法。这是 SQL 标准第 7.17 章节定义的语法，之前的老解析器支持，但在新的 PEG 解析器中尚未实现。

提示词：
你是 DuckDB 的核心开发者。DuckDB 最近迁移到了新的 PEG 解析器，但有一个 SQL 标准语法在迁移过程中丢失了：`FETCH FIRST/NEXT ... ROWS ONLY` 语法。

这个语法和 `LIMIT` 类似，用于限制查询结果行数，例如：
```sql
SELECT * FROM t ORDER BY a FETCH FIRST 2 ROWS ONLY
SELECT * FROM t ORDER BY a FETCH NEXT 1 ROW ONLY
SELECT * FROM t ORDER BY a OFFSET 1 ROW FETCH FIRST 1 ROW ONLY
```

你需要：
1. 理解 DuckDB 的 PEG 解析器架构（grammar 文件、transformer、生成的代码）
2. 找到 SELECT 语句的 grammar 定义位置
3. 在 grammar 中新增 FETCH 子句的语法规则
4. 在 transformer 中实现对应的转换逻辑
5. 更新相关的 grammar_types 定义
6. 添加测试用例验证 all 三种语法形式

注意：需要理解 PEG 解析器的工作方式以及 LIMIT/OFFSET 的现有实现作为参考。FETCH 子句需要和现有的 LIMIT/OFFSET 子句协同工作，支持 `OFFSET ... FETCH ...` 的组合形式。