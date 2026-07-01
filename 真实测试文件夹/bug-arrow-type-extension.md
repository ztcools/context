git checkout 39391b92ca

什么问题：Arrow 类型扩展（Arrow type extension）在输出 Arrow 格式数据时，`ArrowAppender` 和类型扩展之间的编码方式不一致，导致产生的 Arrow schema 与实际数据不匹配。具体表现为 UUID 类型的字符串格式声明、BIT/Bignum 类型的 view 格式支持不完整，以及枚举类型的字典值格式声明不正确。

提示词：
你是 DuckDB 的 Arrow 集成开发者。用户报告了一个 bug：当从 DuckDB 导出 Arrow 格式数据时，带有 UUID 列或 Bit 列的表会出现 schema 不匹配的问题。

具体现象：
1. UUID 类型导出时，ArrowAppender 写入的格式和类型扩展中声明的 schema 格式不一致
2. BIT 类型需要支持 Arrow 1.4+ 的 binary view 格式（`vz`），但当前只处理了 `z`/`Z`
3. 枚举类型的字典值格式声明不正确

你需要：
1. 找到 Arrow 转换相关的代码（`src/common/arrow/` 目录）
2. 理解 `arrow_converter.cpp` 中 `SetArrowFormat` 函数如何为不同类型设置 Arrow schema
3. 理解 `arrow_type_extension.cpp` 中 Arrow 类型扩展如何处理类型编解码
4. 梳理 UUID、BIT、Bignum、枚举类型在转换时的格式声明逻辑
5. 修复 schema 与数据格式不一致的问题
6. 添加测试用例

提示：注意区分 Arrow 的不同格式版本（1.4+ 支持 string view），以及 `ArrowOffsetSize::LARGE` 和 `ArrowOffsetSize::REGULAR` 的区别。