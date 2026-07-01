git checkout cb5d12dbf2

什么问题：DuckDB 的 ICU 扩展已经支持 `date_diff` / `datediff` 函数对 `TIMESTAMPTZ` 类型的计算，但缺少对 `TIMESTAMPTZ_NS`（纳秒精度时区时间戳）类型的支持。这导致下游扩展（如 duckdb-iceberg）在处理 Iceberg v3 的 `timestamptz_ns` 分区转换时无法复用现有的 `date_diff` 表达式路径。

提示词：
你是 DuckDB 的核心开发者。duckdb-iceberg 扩展需要支持 Iceberg v3 的 `timestamptz_ns` 类型的时间分区转换（如 `date_diff('year', ..., source_column)`），但目前 DuckDB 的 ICU 扩展中 `date_diff` 和 `datediff` 函数只注册了 `TIMESTAMPTZ` 类型的重载，没有 `TIMESTAMPTZ_NS` 类型的重载。

你的任务：
1. 找到 ICU 扩展中 `date_diff` / `datediff` 函数的实现位置，理解现有的 `TIMESTAMPTZ` 支持是如何工作的
2. 为 `TIMESTAMPTZ_NS` 类型添加对应的函数重载（注意：`TIMESTAMPTZ_NS` 使用纳秒精度，需要适配微秒和纳秒之间的转换）
3. 更新扩展函数注册表（extension entries），确保新的重载能被自动发现和加载
4. 添加测试用例，覆盖 `date_diff` / `datediff` 对 `TIMESTAMPTZ_NS` 的各种 date part（year, month, day, hour 等）

注意：需要理解 ICU 日历函数的工作方式，以及 `TIMESTAMPTZ` 和 `TIMESTAMPTZ_NS` 之间的精度差异。现有的 `TIMESTAMPTZ` 实现是很好的参考，但需要注意纳秒→微秒的转换逻辑。