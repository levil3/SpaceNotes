# v0.2.0 合并前回归证据

测试日期：2026-10-23

## 环境

- macOS 27.0.1（26A434），Apple Silicon
- Node.js 24.22.1（应用内 sidecar）
- 最终产物：`build/macos/Levil Notes 0.2.0.dmg`
- SHA-256：`1f69411b42b1d4d64e9353595c35578493daa5dec79fbcde58433268cdc86db6`

## 自动化检查

| 检查 | 结果 |
| --- | --- |
| `npm test` | 10 个测试文件，52 项通过 |
| `npm run build:web` | TypeScript 检查和 Vite 构建通过 |
| `swift test` | 5 项通过 |
| sidecar/SSE 退出回归 | 通过，SIGTERM 后在超时内退出 |
| 工作流 YAML 与 shell 语法 | 通过 |
| DMG `hdiutil verify` | 通过 |
| ad-hoc `codesign --verify --deep --strict` | 通过 |
| DMG SHA-256 校验 | 通过 |
| Mach-O 清单 | 2 个二进制，均包含 `arm64 x86_64` |
| arm64 `--smoke-test` | 通过 |
| x86_64（Rosetta）`--smoke-test` | 通过 |

## 真实应用

- 从最终 DMG 安装到 `/Applications/Levil Notes.app`。
- WKWebView 端到端流程 50/50 通过，覆盖文件打开、搜索、大纲、标签、
  bridge 写入、Git 面板、设置、原生废纸篓和 `notes-asset://` 图片加载。
- 3,000 次使用模型抽样通过，零失败、零数据损坏、SSE 与 Git 操作验证通过。
- sidecar 首次异常后自动重启并重新加载 WebView；第二次异常后停止重启并保留诊断。
- 正常退出后应用与 sidecar 均无残留。
- System Events 可读取应用菜单；统一 CUA 入口不可用，系统截图因权限返回全黑，
  因此不声明截图验收通过。

## 已声明边界

- 没有 Intel 实机；x86_64 仅在本机通过 Rosetta 和构建脚本验证，Intel runner
  由 CI 配置覆盖。
- DMG 为 ad-hoc 签名、无 Apple 公证；`spctl` 拒绝是预期行为，安装时需通过
  “系统设置 > 隐私与安全性 > 仍要打开”。
