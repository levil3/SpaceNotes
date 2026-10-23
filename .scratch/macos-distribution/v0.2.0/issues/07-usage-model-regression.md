# 07: 建立 sidecar 与桥接使用模型回归

Parent: #1
GitHub: #8

**What to build:** 自动化回归工具从真实用户工作流生成固定种子的操作序列，通过
桥接和 sidecar 执行至少 3,000 次抽样，比较返回值、事件、文件哈希和 Git 引用，
发现失败时可稳定重放。

**Blocked by:** #4

**Status:** completed

- [x] 使用模型覆盖笔记库、编辑保存、搜索、附件和 Git 主要工作流。
- [x] 固定种子能生成可重放的至少 3,000 个操作样本。
- [x] 每次抽样检查返回值、事件和文件副作用。
- [x] 零失败与零数据损坏作为退出码门槛。
- [x] 失败报告包含种子、操作序列、预期结果和实际结果。
- [x] 回归工具在 CI 和本地均可运行。

Final delivery: fixed seed `20261023`, 3,000/3,000 operations passed with zero
failures and zero data corruption. CI run `39974114613` also passed 89/89
application tests.
