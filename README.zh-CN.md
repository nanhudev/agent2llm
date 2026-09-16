# Agent2LLM

[![CI](https://github.com/nanhudev/agent2llm/actions/workflows/ci.yml/badge.svg)](https://github.com/nanhudev/agent2llm/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)
[![协议](https://img.shields.io/badge/protocol-a2l%2F1-blue.svg)](./docs/protocol/a2l-protocol.md)

**最强模型负责思考，你顺手的 Agent 负责干活。**

用 ChatGPT 或 Claude 当推理大脑，驱动 DeepSeek Harness、WorkBuddy、Codex、
Cursor、Claude Code 等执行 Agent。

```text
N 个 Brain Adapter  ×  M 个 Harness Adapter  =  N × M 自由组合
```

---

## 它不是什么

| 不是 | 而是 |
| --- | --- |
| OpenAI 兼容网关 | 本地协作运行时 |
| API Key 聚合器 | 角色 / 能力协议（`a2l/1`） |
| ChatGPT / Claude 反向代理 | 官方界面自动化 + 用户本人登录 |
| 又一个 coding agent | 连接「大脑」与你现有 Agent 的一层 |

核心只有一句话：

```text
Brain 思考。Hands 执行。Core 治理。
```

---

## 唯一真正重要的设计

> Brain 审查的是**真实工作区**，而不是 Harness 的自我介绍。

Harness 说「测试通过了」那叫声明；`git_diff` 才叫证据。所以：

- **控制面** —— 极小的 A2L 消息：状态、id、计数、意图。预算 `< 4 KB`，
  Web 大脑目标 `< 1 KB`。
- **数据面** —— 只读 MCP 服务。Brain 按需拉取。

---

## 架构

```text
               Brain 层

       ChatGPT    Claude     API      Mock
          │         │         │        │
          └────┬────┴────┬────┘        │
               │         │             │
          BrainAdapter（统一契约）
               │
      ┌────────┴─────────────────────────┐
      │        A2L 协议 / Core           │
      │  状态机 · 权限 · 兼容性 · 会话    │
      └────────┬─────────────────────────┘
               │
        HarnessAdapter（统一契约）
               │
   ┌───────────┼────────────┬───────────┐
  DSH      WorkBuddy     Codex      Cursor
   │           │            │           │
Claude Code  OpenCode     Mock       你的
```

两个平面：

```text
Brain
  │ 控制消息（很小）
  ▼
Agent2LLM Core
  │
  ├── 只读 MCP ──> 工作区
  │
  └── 执行请求 ──> Harness ──> 修改工作区
```

---

## 安装

源码安装（尚未发布 npm 包）：

```bash
git clone https://github.com/<you>/agent2llm.git
cd agent2llm
npm install
npm run build
node apps/cli/dist/index.js version
```

要求 **Node.js >= 20**。

---

## 快速开始

```bash
agent2llm                 # 交互式启动
agent2llm detect          # 本机装了哪些 Agent
agent2llm doctor          # 健康检查 + 修复建议
agent2llm adapters        # 实现 / 检测到 / 已验证，如实呈现
```

交互式启动：

```text
Agent2LLM

Your best model thinks.
Your favorite agent builds.

Brains
✓ ChatGPT
○ Claude
○ API Provider

Harnesses
✓ DeepSeek Harness
✓ WorkBuddy
✓ Codex
○ Cursor
○ Claude Code
○ OpenCode
```

非交互式：

```bash
agent2llm run \
  --brain chatgpt-web \
  --harness dsh \
  --workflow brain-hands \
  --workspace . \
  --goal "实现暗色模式"
```

只验证组合是否可行、不接触任何外部产品：

```bash
agent2llm run --brain chatgpt-web --harness workbuddy --dry-run
```

---

## 一次协作长什么样

```text
$ agent2llm run --brain chatgpt-web --harness dsh --goal "实现登录鉴权"

启动 ChatGPT × DeepSeek Harness

Brain      正在检查工作区...
Brain      计划已就绪（4 个动作）
Harness    执行第 1 轮...
Harness    改动 7 个文件，18 个测试通过
Brain      正在审查真实 diff...
Brain      需要返工
Harness    执行第 2 轮...
Brain      复查...
完成。
```

用户默认看不到 OAuth scope、PKCE verifier、localhost 端口和原始协议包。
想看就用 `--verbose` / `--debug` / `--json`。

---

## 命令

```text
agent2llm setup                      连接 Brain（官方界面，用户本人登录）
agent2llm run                        开始一次协作
agent2llm detect                     检测本机 Agent
agent2llm doctor                     健康检查 + 修复
agent2llm adapters | brains | harnesses
agent2llm session list|show|resume|stop
agent2llm workspace list|add|remove
agent2llm pair | unpair
agent2llm logs
agent2llm config
agent2llm version
```

`detect`、`doctor`、`adapters`、`session` 等都支持 `--json`，方便其他 Agent
机器读取。

---

## 支持矩阵（如实版）

开发机上 `agent2llm adapters` 的实际输出：

| Adapter | 角色 | 状态 | 真实端到端 |
| --- | --- | --- | --- |
| `mock-brain` | brain | verified | 已跑通 |
| `chatgpt-web` | brain | implemented | **未验证** — 需登录 |
| `claude-web` | brain | implemented | **未验证** — 需登录 |
| `api` | brain | implemented | **未验证** — 需 Key |
| `dsh` | harness | **已检测**（`0.1.2-rc.1`） | 未跑（会消耗额度） |
| `workbuddy` | harness | **已检测**（`codebuddy` 2.137.1） | 未跑 |
| `codex` | harness | implemented | **未验证** — 本机未安装 |
| `cursor` | harness | implemented | **未验证** — 本机未安装 |
| `claude-code` | harness | implemented | **未验证** — 本机未安装 |
| `opencode` | harness | implemented | **未验证** — 本机未安装 |
| `mock-harness` | harness | verified | 已跑通 |

API Brain 是唯一没有自带 MCP 客户端的 Brain，因此它通过进程内的只读工具面 +
provider 的 tool calling 来读取工作区。没有 data plane 时它会如实声明「无工作区
访问」，绝不假装 —— 见 [`docs/adapters/api.md`](docs/adapters/api.md)。

图例：**implemented** = 代码完整且契约测试通过 · **detected** = 本机已找到 ·
**verified** = 端到端实测通过。

README 不会把没验证过的东西写成「完全支持」。

---

## 安全模型

- **Brain 不能写。** 不存在 `write_file`、`shell`、`git_commit`、
  `install_package` —— Brain 侧的服务根本没有这些工具。
- **文件内容不能授予权限。** 权限来自代码和配置，不来自模型文本。
  提示词注入最多误导判断，拿不到 shell。
- **规范化路径 containment。** `../`、绝对路径、符号链接、目录符号链接、
  junction、大小写绕过，全部 fail closed。
- **敏感文件默认拒绝。** `.env`、私钥、SSH/云凭证、token 文件、认证数据库、
  浏览器 profile。`.env.example` 可读。
- **不透明工作区 id。** Brain 只看到 `a2lw_…`，看不到文件系统路径。
- **OAuth 2.1 + PKCE S256 + DCR**，轮换 refresh token、哈希存储、一次性配对码
  （TTL + 次数限制 + 限流）。
- **日志脱敏。** token、配对码、Key、cookie、Authorization 头。
- **不反代、不偷 cookie、不拦截私有 API。** 验证码、2FA、登录一律由你本人
  在官方界面完成。

完整模型见 [`docs/security/threat-model.md`](docs/security/threat-model.md)。

---

## 加一个自己的 Harness

只写一个类：

```ts
export class MyHarness extends HarnessAdapterBase {
  metadata() { return { id: "my-harness", name: "My Harness", version: "0.1.0", role: "harness" }; }
  async capabilities() { /* 只声明真实存在的能力 */ }
  async execute(session, task) { /* 真的去执行 */ }
}
```

以 `@agent2llm/harness-my-harness` 发布，manifest 里带上 `apiVersion`。然后：

```text
ChatGPT   × My Harness
Claude    × My Harness
API Brain × My Harness
```

全部自动成立，**不需要改 Core 一行代码**。这就是本项目的成功标准。

---

## 上游归属

Agent2LLM 大量改编了
[`XiaoDuoYa/codex-with-chatgpt`](https://github.com/XiaoDuoYa/codex-with-chatgpt)
（MIT）中已成熟且安全关键的代码：OAuth/PKC−/配对、工作区 containment、只读
MCP、执行记录、隧道与守护进程生命周期、脱敏日志。详见
[`docs/C2C_REUSE_MAP.md`](docs/C2C_REUSE_MAP.md) 与
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

协议是 **A2L**（`a2l/1`）而非 C2C；保留了状态映射表便于迁移。

---

## 开发

```bash
npm run build       # tsc -b
npm run typecheck
npm test            # 协议 / 契约 / 安全 / 编排，共 67 项
npm run lint
npm run verify
```

## 文档

- [架构总览](docs/architecture/overview.md) ·
  [Adapter 架构](docs/architecture/adapters.md) ·
  [浏览器传输](docs/architecture/browser-transport.md) ·
  [工作区 Broker](docs/architecture/workspace-broker.md)
- [A2L 协议](docs/protocol/a2l-protocol.md) ·
  [状态机](docs/protocol/state-machine.md)
- [威胁模型](docs/security/threat-model.md) ·
  [工作区隔离](docs/security/workspace-isolation.md)
- [工作流](docs/workflows/README.md) ·
  [故障排查](docs/troubleshooting.md)
- [ADR](docs/adr/) · [前置研究：C2C](docs/prior-art/C2C.md)

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
