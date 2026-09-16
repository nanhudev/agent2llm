# Agent2LLM

[![CI](https://img.shields.io/badge/CI-ready-blue)](./.github/ci/github-actions.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![协议](https://img.shields.io/badge/protocol-a2l%2F1-blue.svg)](./docs/protocol/a2l-protocol.md)

[English](./README.md) · 简体中文

用 ChatGPT 或 Claude 当大脑，驱动 DeepSeek Harness、WorkBuddy、Codex、Cursor、
Claude Code、OpenCode 干活。

```text
N 个 Brain 适配器  ×  M 个 Harness 适配器  =  N × M 种组合
```

## 为什么做这个

[XiaoDuoYa/codex-with-chatgpt](https://github.com/XiaoDuoYa/codex-with-chatgpt)
证明了一件事：聊天框可以当控制平面。ChatGPT 出计划，Codex 执行，两边之间只跑一小段
文本协议。那是个好活，但它焊死在 Codex 上——一个大脑配一个执行器。

Agent2LLM 留下思路，去掉焊接。Brain 和 Harness 分列适配器边界两侧，任何一个大脑都能
驱动任何一个执行器：

- Brain：`chatgpt-web`、`claude-web`、`api`、`mock-brain`
- Harness：`dsh`、`workbuddy`、`codex`、`cursor`、`claude-code`、`opencode`、
  `mock-harness`

新增一边不影响另一边。整个设计就这一句话。

## 它是怎么跑的

两条平面，刻意分开。

```text
Brain                    控制平面：状态、id、计数、意图。
  │                      预算 < 4 KB，走网页 UI 时 < 1 KB。
  │ control（很小）
  ▼
Agent2LLM Core
  │
  ├── 只读 MCP ──> 工作区      Brain 自己去取需要的
  │
  └── ExecutionRequest ──> Harness ──> 修改工作区
```

分开只为一条理由：**Brain 审的是真实工作区，不是 Harness 的转述。** Harness 说"测试
过了"是主张，`git_diff` 才是证据。所以 Brain 拿到的是真实工作区的只读视图。

面向 Brain 的 MCP 服务里没有 `write_file`，没有 `shell`，没有 `git_commit`，没有
`install_package`。这些工具根本不存在。Brain 负责判断，Harness 负责动手。

## 安装

还没发 npm 包，从源码装：

```bash
git clone https://github.com/nanhudev/agent2llm.git
cd agent2llm
npm install
npm run build
node apps/cli/dist/index.js version
```

需要 **Node.js >= 20**。

## 快速开始

```bash
agent2llm                 # 交互式启动器
agent2llm detect          # 这台机器上装了什么
agent2llm doctor          # 体检，带修复建议
agent2llm adapters        # 每个适配器的 implemented / detected / verified
```

非交互：

```bash
agent2llm run \
  --brain chatgpt-web \
  --harness dsh \
  --workflow brain-hands \
  --workspace . \
  --goal "实现暗色模式"
```

不碰任何产品，只验证配对是否成立：

```bash
agent2llm run --brain chatgpt-web --harness workbuddy --dry-run
```

## 让它驱动一个你已经开着的窗口

ChatGPT 和 Claude 这两个 Web Brain 需要一个浏览器。这一环最容易搞错，所以把三种方式
和优先级写清楚。

| 顺序 | 模式 | 实际发生什么 | 代价 |
| --- | --- | --- | --- |
| 1 | `cdp` | 接管一个已经开着的窗口 | 没有——你本来就登录着 |
| 2 | `playwright` | 自己启动一个带独立 profile 的浏览器 | 要重新登录；新起的 Chromium 正是反自动化检测盯的东西 |
| 3 | `manual` | Agent2LLM 把消息写到文件，你复制粘贴 | 慢，但永远可用，零依赖 |

优先接管的原因很实在：更便宜也更稳。会话活在一个你能看见的窗口里，跨 CLI 调用还在，
不用登两次。

**这不是桌面版专属功能。** 这条 transport 说的是 DevTools 协议，任何暴露了调试端口的
Chromium 窗口都能接管——桌面版可以，你自己的 Edge/Chrome 也可以。没有 per-app 适配器
要维护。

带调试端口启动一个窗口。以 Edge 为例（本项目的实测对象就是它）：

```bash
msedge --remote-debugging-port=9222 --user-data-dir=%LOCALAPPDATA%\a2l-window
```

确认被识别，然后运行：

```bash
agent2llm detect                       # 'Window attach' 应显示 PASS
agent2llm run --brain chatgpt-web --harness workbuddy \
  --goal "给 README 加一个徽章" \
  --endpoint http://127.0.0.1:9222
```

`--endpoint` 是 `AGENT2LLM_ATTACH_ENDPOINT` 的快捷写法，两个都不给就扫三个默认端口。

只有 `/json/version` 应答并且报出引擎名，才会被当成可接管。端口开着不算证据——随便什么
进程都能占着端口，靠猜会把"没有窗口"变成后面一个莫名其妙的协议错误。断开只结束我们的
会话，不关窗口，`tests/cdp-attach.test.mjs` 里有这条断言。

### 关于桌面版

Electron 或 WebView2 外壳应该和任何 Chromium 外壳一样接受 `--remote-debugging-port`，
那样它就走上面 Edge 的同一条路径。但某个具体版本允许不允许这个参数，是逐版本的事，
读多少文档都没用，只有启起来看一眼才知道。

```bash
# 带调试端口把它启动起来，然后：
agent2llm detect
```

通了，`detect` 和 `doctor` 会告诉你；没通，它们也会如实说。在一台没装桌面版的机器上，
这个项目能诚实给出的结论就到这里——见[目前缺什么](#目前缺什么)。

## 命令

```text
agent2llm setup                      连接 Brain（官方 UI，人工登录）
agent2llm run                        开始一次协作
agent2llm detect                     探测本机装了哪些 agent
agent2llm doctor                     体检 + 修复建议
agent2llm adapters | brains | harnesses
agent2llm session list|show|resume|stop
agent2llm workspace list|add|remove
agent2llm pair | unpair
agent2llm logs
agent2llm config
agent2llm version
```

`detect`、`doctor`、`adapters`、`session` 等命令都支持 `--json`，方便别的 agent 消费。

## 适配器状态

取自开发机上的 `agent2llm adapters`。口径：**implemented** = 代码写完且契约测试全绿 ·
**detected** = 在这台机器上找到了 · **verified** = 真的跑通过一次端到端。

| 适配器 | 角色 | 状态 | 端到端 |
| --- | --- | --- | --- |
| `mock-brain` | brain | verified | 是 |
| `chatgpt-web` | brain | implemented | 未跑——需要登录 |
| `claude-web` | brain | implemented | 未跑——需要登录 |
| `api` | brain | implemented | 未跑——需要密钥 |
| `workbuddy` | harness | detected（`codebuddy` 2.137.1） | 未跑 |
| `dsh` | harness | detected（`dsh` 0.1.2-rc.1） | 未跑 |
| `codex` | harness | implemented | 本机未安装 |
| `cursor` | harness | implemented | 本机未安装 |
| `claude-code` | harness | implemented | 本机未安装 |
| `opencode` | harness | implemented | 本机未安装 |
| `mock-harness` | harness | verified | 是 |

API Brain 是唯一没有自带 MCP 客户端的大脑，所以它拿到的是进程内的只读工具面，通过
provider 的 tool calling 去调。没有数据平面时它直接声明自己没有工作区访问权限，而不是
假装有——详见 [`docs/adapters/api.md`](docs/adapters/api.md)。

## 目前缺什么

列在这儿是因为它们是真的，不是因为它们好看。

- 只有 `mock-brain` × `mock-harness` 这一对跑通过端到端。其余是契约测试 + dry-run。
- 没有对真实的 ChatGPT / Claude 账号验证过任何东西。浏览器链路只验证到"页面加载成功"
  这一步，登录、MCP 配对、完整一轮对话都没验证。
- 桌面版没试过，因为本机没装。
- Web Brain 是抓 UI 的，站方改版选择器就会失效。每个 Brain 的选择器集中在一个文件里，
  这是故意的。
- `chatgpt.com` 必须可达。Cloudflare 对 headless Chromium 回 403；transport 跑有头
  模式，登录、验证码、两步验证一律由人在官方界面完成，绝不做自动化绕过。
- CI 默认关闭——见[启用 CI](#启用-ci)。

## 安全模型

- **Brain 不能写。** 面向 Brain 的工具面里没有 `write_file`、`shell`、`git_commit`、
  `install_package`。
- **文件内容不能授权。** 权限来自代码和配置，永不来自模型文本。提示注入能误导判断，
  但发不出一个 shell。
- **规范路径收敛。** `../`、绝对路径、符号链接、目录符号链接、junction、大小写花招
  一律 fail closed。
- **敏感文件拒绝访问。** `.env`、密钥、SSH 与云凭据、token 文件、认证数据库、浏览器
  profile。`.env.example` 保持可读。
- **工作区 id 不透明。** Brain 看到的是 `a2lw_…`，永远不是文件系统路径。
- **OAuth 2.1 + PKCE S256 + DCR**，刷新令牌轮转，静态哈希存储，一次性配对码带 TTL
  和限流。
- **日志脱敏。** token、配对码、密钥、cookie、认证头。
- **不做反向代理、不窃取 cookie、不拦截私有 API。** 登录、验证码、两步验证都由你在
  官方界面完成。

完整模型：[`docs/security/threat-model.md`](docs/security/threat-model.md)。

## 自己写一个 Harness

一个类，一份 manifest：

```ts
export class MyHarness extends HarnessAdapterBase {
  metadata() {
    return { id: "my-harness", name: "My Harness", version: "0.1.0", role: "harness" };
  }
  async capabilities() { /* 真实存在什么就声明什么 */ }
  async execute(session, task) { /* 真的把它跑起来 */ }
}
```

以 `@agent2llm/harness-my-harness` 发包，manifest 里带上 `apiVersion`，它就能和上面
所有 Brain 组合，Core 一行不用改。

## 上游归属

Agent2LLM 改编了
[`XiaoDuoYa/codex-with-chatgpt`](https://github.com/XiaoDuoYa/codex-with-chatgpt)（MIT）
中大量安全关键代码：OAuth/PKCE/配对、工作区收敛、只读 MCP、执行记录、隧道与守护进程
生命周期、脱敏日志。见
[`docs/C2C_REUSE_MAP.md`](docs/C2C_REUSE_MAP.md) 与
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

本项目的协议叫 A2L（`a2l/1`），不是 C2C。为方便迁移保留了一份状态映射。

## 开发

```bash
npm run build       # tsc -b
npm run typecheck
npm test            # 协议、契约、安全、编排、transport
npm run lint
npm run verify
```

测试就是普通 Node 脚本，不需要装测试框架。每个文件独立进程跑，用隔离的
`AGENT2LLM_STATE_DIR`。

### 浏览器引擎（可选）

Web Brain 通过 Playwright 驱动官方 UI。它是可选的：不装，Web Brain 照样能走 `cdp`
或 manual 模式。

```bash
npm i -D playwright
npx playwright install chromium
```

Chromium 约 310 MB。想不占系统盘，要么装之前设 `PLAYWRIGHT_BROWSERS_PATH`，要么装到
默认位置再放一个目录联接（junction）指向别的盘——联接方案运行时不需要任何环境变量。

### 启用 CI

workflow 放在
[`.github/ci/github-actions.yml`](.github/ci/github-actions.yml)（Linux / Windows /
macOS × Node 20 / 22），而不是 `.github/workflows/` 下面。原因是 GitHub 会拒绝任何
触碰该目录的推送，除非凭据带 `workflow` scope，而推送是原子的：一个文件被拒，整批都被拒。

```bash
node scripts/enable-ci.mjs    # 复制到 .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: enable GitHub Actions workflow"
```

那一次推送需要一个同时具备 `repo` 和 `workflow` scope 的 token。

## 文档

- [架构总览](docs/architecture/overview.md) ·
  [适配器](docs/architecture/adapters.md) ·
  [浏览器 transport](docs/architecture/browser-transport.md) ·
  [工作区中介](docs/architecture/workspace-broker.md)
- [A2L 协议](docs/protocol/a2l-protocol.md) ·
  [状态机](docs/protocol/state-machine.md)
- [威胁模型](docs/security/threat-model.md) ·
  [工作区隔离](docs/security/workspace-isolation.md)
- [工作流](docs/workflows/README.md) · [故障排查](docs/troubleshooting.md)
- [ADR](docs/adr/) · [前作：C2C](docs/prior-art/C2C.md)

## 许可

MIT——见 [LICENSE](LICENSE)。
