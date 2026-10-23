# 确定 macOS 支持矩阵与安装体验

Type: grilling
Status: resolved
Blocked by: 05

## Question

通用 Node 与 DMG 的可行方案确认后，第一版明确支持哪些 macOS 版本、硬件和
安装路径？

需要决定：

- 最低 macOS 版本，以及是否承诺 Rosetta、Intel 实机或 Apple Silicon 实机验证。
- 无签名 DMG 的安装说明、隔离属性处理方式和安全提示文案。
- 自动更新是否属于第一版；若不包含，用户如何发现新版本。
- 首次启动、sidecar 缺失或被系统拦截时的可诊断错误表现。

## Answer

- 最低 macOS 版本为 `13.5`，与 Node 24 官方二进制一致。
- 交付一个包含 arm64 与 x86_64 的 universal `.app` 和 DMG。
- CI 使用固定的 `macos-15` 与 `macos-15-intel` 分别构建并执行架构冒烟测试。
- 当前没有 Intel 实机，因此第一版不把 Intel 人工验证设为发布门槛；实际拥有
  Intel 设备后再补抽查，不因此缩减双架构构建和 CI 校验。
- 第一版不含自动更新。
- 无签名安装说明以“系统设置 > 隐私与安全性 > 仍要打开”为准，不把右键打开
  作为稳定流程。
