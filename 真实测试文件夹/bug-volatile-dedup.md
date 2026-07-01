git checkout b980d824d1

什么问题：窗口函数中使用 `volatile` 函数（如 `uuid()`, `random()`, `gen_random_uuid()`）时，优化器在去重逻辑中错误地将两个相同的 volatile 表达式合并为一个，导致每次调用应该生成不同值的函数被错误地复用，产生相同的 UUID 而非独立的 UUID。

提示词：
你是 DuckDB 的核心开发者。有用户报告了一个 bug：

```sql
CREATE TABLE t(g INT);
INSERT INTO t VALUES (1), (1), (2);
SELECT any_value(uuid()::VARCHAR) OVER (PARTITION BY g) AS id_a,
       any_value(uuid()::VARCHAR) OVER (PARTITION BY g) AS id_b
FROM t;
```

预期：`id_a` 和 `id_b` 在同一分区内应该是不同的 UUID 值。
实际：`id_a` 和 `id_b` 总是返回相同的值。

问题根因是优化器将两个结构相同的 `any_value(uuid()) OVER (...)` 表达式当成重复表达式去重合并了，但 `uuid()` 是 volatile 函数，每次调用应该产生不同的值。

你需要：
1. 理解 DuckDB 中 volatile 函数的概念和标记方式
2. 找到哪些优化器阶段会进行表达式去重
3. 定位具体是哪个代码路径导致了 volatile 表达式的错误去重
4. 添加 volatile 检查，跳过 volatile 表达式的去重
5. 添加测试用例验证修复

提示：可能涉及的有窗口执行计划构建（`plan_window.cpp`）和通用聚合优化器（`common_aggregate_optimizer.cpp`），需要理解窗口函数如何被转换成聚合表达式，以及去重逻辑在哪里触发。