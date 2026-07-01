仓库地址：https://github.com/tokio-rs/tokio.git
git checkout 923e7234

什么问题：Tokio 的 alternative timer 实现中，`Timer::reset()` 方法可能导致 timer 被注册到不同的 runtime 上。当用户在一个 runtime 中创建 timer，然后在另一个 runtime 中调用 `reset()` 时（或 runtime 的 context 在 reset 期间发生了变化），timer 会被错误地注册到新的 runtime 上，导致 timer 行为异常——可能永远不触发或产生错误的唤醒。

MCP优势：需要理解 Tokio 的 runtime 架构（Handle 类型、context 机制、TempLocalContext），涉及跨模块的运行时上下文传递逻辑，不是简单的 grep 能定位的

提示词：
你是 Tokio 的核心开发者。有用户报告了一个关于 alternative timer 的 bug：

用户在使用 `tokio::time::Sleep` 的 `.reset()` 方法来重置一个定时器时，发现定时器有时会"失效"——即永远不会触发。经过排查，发现这个问题似乎与多 runtime 场景有关。

具体来说：
- `Timer::new(handle, deadline)` 在创建时接收一个 `scheduler::Handle` 来指定它属于哪个 runtime
- 但 `Timer::reset()` 调用 `Timer::new()` 时，没有传入原始的 `Handle`，而是依赖 `with_current_temp_local_context` 获取当前 runtime 上下文
- 如果 `reset()` 发生在不同的 runtime 上下文中，timer 会被注册到错误的 runtime 的时序队列中
- 另外，`scheduler::Handle` 有 `CurrentThread` 和 `MultiThread` 两种变体，需要正确比较两个 Handle 是否指向同一个 runtime

你需要：
1. 找到 `Timer` 的实现代码和 `reset()` 方法
2. 理解 `with_current_temp_local_context` 函数如何获取当前 runtime 上下文
3. 理解 `scheduler::Handle` 的 `CurrentThread` 和 `MultiThread` 变体的区别
4. 在 `reset()` 中传入原始的 runtime handle，并在注册 timer 时检查 runtime 是否匹配
5. 添加测试用例验证多 runtime 场景下的 timer 行为

先定位 alternative timer 相关代码，理解 runtime 上下文传递机制，再进行修改。