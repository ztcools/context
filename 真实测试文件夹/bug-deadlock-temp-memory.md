仓库地址：https://github.com/duckdb/duckdb.git
git checkout 5e09cde1eb

什么问题：`TemporaryMemoryManager` 中的内存分配算法在极端情况下会产生死锁。当多个操作符竞争临时内存时，`ComputeDerivatives` 函数使用大规模乘积计算导致数值溢出/下溢，进而导致导数计算错误，使得分配算法无法正确收敛，最终耗尽剩余内存导致死循环。

MCP优势：需要理解临时内存管理器的分配算法（基于导数的优化分配），需要跨模块理解成本函数和导数计算，向量索引可快速定位 `TemporaryMemoryManager` 的实现

提示词：
你是 DuckDB 的核心存储引擎开发者。有用户报告了一个问题：在高并发查询场景下，DuckDB 偶尔会卡住不动，看起来像是死锁或死循环。

初步排查发现，问题出在 `TemporaryMemoryManager` 的内存分配逻辑中。当多个查询同时需要临时内存时，分配算法似乎在某些边界条件下无法收敛，导致无限循环。

具体来说：
- `ComputeDerivatives` 函数计算每个操作符的"成本导数"来决定内存分配
- 当前实现使用大量乘积运算（`prod_res`、`prod_siz`），当操作符数量较多时会导致数值溢出
- 导数计算中的 `pow(prod_res / prod_siz, 1/nd)` 在极端值下不稳定
- 当导数计算错误时，`ComputeReservation` 中的优化循环无法正确分配内存，导致 `remaining_memory` 永远不为零

你需要：
1. 找到 `TemporaryMemoryManager` 的实现代码
2. 理解 `ComputeDerivatives` 和 `ComputeReservation` 的算法逻辑
3. 将乘积运算改为对数运算（`log` + `exp`）以提高数值稳定性
4. 修复死循环问题，添加适当的终止条件
5. 添加测试用例

提示：关注 `src/storage/temporary_memory_manager.cpp` 中的数学运算，特别是 `prod_res`、`prod_siz` 和 `pow` 相关的计算。