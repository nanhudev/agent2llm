# Agent2LLM

<p align="center">
  <strong>让最强的模型负责思考，让你喜欢的 Agent 负责执行。</strong>
</p>

<p align="center">
  把长期存在的 AI 大脑，与真正能操作项目的执行 Agent 连接起来。
</p>

<p align="center">
  <a href="./README.md">English</a>
  ·
  <a href="./CHANGELOG.md">Changelog</a>
  ·
  <a href="./LICENSE">MIT License</a>
</p>

---

Agent2LLM 想做的事情很简单：

**把思考和执行拆开。**

让 ChatGPT、Claude 或 API 模型成为长期存在的 **Brain**。

让 Codex、WorkBuddy、Cursor、Claude Code、DeepSeek Harness、OpenCode 等 Agent 成为真正负责动手的 **Hands**。

```text
             BRAIN
      ChatGPT / Claude / API
               │
            决定下一步
               │
               ▼
          Agent2LLM
               │
            执行任务
               │
               ▼
             HANDS
 Codex / WorkBuddy / Cursor / ...
               │
            真正执行
               │
               ▼
            真实证据
               │
               └──────────────> 回到同一个 Brain 对话
```

**一个长期大脑，多次短执行。**

不用每次重新认识整个项目。

---

## 为什么做这个？

现在很多 Coding Agent 同时承担两件事情：

1. 理解和规划；
2. 操作电脑并执行。

这当然可以工作。

但如果你已经和 ChatGPT 或 Claude 聊了很久，项目为什么这么设计、哪些方案试过、哪里失败了、下一步做什么，它其实都已经知道。

这时候再让执行 Agent 从头理解一遍，就会产生很多重复上下文和重复规划。

Agent2LLM 希望让 Brain 保留长期信息，而每次只给 Harness 一个很小的任务：

```text
NEXT ACTION
为空项目名称增加校验。

ACCEPTANCE
- 空名称会被拒绝
- 原有合法名称继续正常工作
- 相关测试通过
```

Harness 专注执行。

结果再回到原来的 Brain 对话，由 Brain 决定下一步。

> **不是让 AI 少思考，而是让两个 AI 别重复思考。**

---

## Brain × Harness

Agent2LLM 不只是一个 ChatGPT → Codex Bridge。

两边都被拆成了 Adapter。

### Brain

目前包括：

- ChatGPT Web
- Claude Web
- API 模型
- 用于测试的 Mock Brain

### Harness

目前包括：

- Codex
- WorkBuddy
- Cursor
- Claude Code
- DeepSeek Harness
- OpenCode
- 用于测试的 Mock Harness

最终想实现的是：

```text
N 个 Brain × M 个 Harness
```

Brain 不应该关心最后是哪一个 Agent 动手。

Harness 也不应该必须拥有整段长期对话。

需要说明的是：仓库里存在 Adapter，不代表所有组合都已经在所有机器上完成真实验证。实际运行仍然取决于安装状态、登录、额度，以及第三方工具本身开放的能力。

---

## 安装

需要 Node.js 20 或更高版本。

```bash
npm install -g agent2llm
```

全局安装会同时在桌面创建一个 **Agent2LLM Dock** 快捷方式，双击即可直接打开 Dock。设置 `AGENT2LLM_NO_SHORTCUT=1` 可以跳过，之后也可以用 `a2l dock shortcut --remove` 移除。

检查当前机器：

```bash
a2l doctor
a2l adapters
```

`a2l adapters` 默认只列出这台机器现在就能用的 Adapter；`a2l adapters --all` 会把还需要配置的一起列出来。

`agent2llm` 完整命令仍然可以使用，但现在推荐使用更短的：

```bash
a2l
```

---

## 快速开始

创建一个 Pair：

```bash
a2l pair create --brain chatgpt-web --harness codex
```

给它一个目标：

```bash
a2l run "增加一个 slugify 工具函数并补测试"
```

之后继续：

```bash
a2l run "现在让它正确处理 Unicode"
```

第二个 Run 可以继续使用第一个 Run 的 Brain 对话，而不是重新从零建立上下文。

一个 **Pair** 可以简单理解为：

```text
Brain + Harness + 长期 Brain 对话 + 项目上下文
```

---

## Dock

不想一直敲命令，也可以直接打开本地界面：

```bash
a2l dock
```

Dock 可以完成 Pair 创建、输入目标、开始执行，并查看当前运行状态。

运行 `a2l dock` 时页面会自动打开：优先使用 Edge 或 Chrome 的应用窗口，否则使用默认浏览器。只需要 URL 的话，加 `--no-open`。

```text
┌─────────────────────────────────────────┐
│ BRAIN                     HANDS         │
│ ChatGPT                   Codex         │
│                                         │
│              ● PAIRED                   │
├─────────────────────────────────────────┤
│ 希望它们完成什么？                      │
│                                         │
│ [ 给设置页面增加输入校验             ] │
│                                Run      │
├─────────────────────────────────────────┤
│ Brain → Hands → Evidence → Brain        │
└─────────────────────────────────────────┘
```

Dock 在本机运行。

它不需要把 ChatGPT、Codex 或其他软件的窗口嵌进自己，也不需要移动或接管其他应用窗口。

---

## 不只相信一句 “Done”

Agent 说“已经完成”，仍然只是它自己的声明。

执行结束以后，Agent2LLM 可以检查真实仓库中能够观察到的变化，再把紧凑的 Evidence 送回 Brain。

例如：

```text
Changed
src/project.ts
tests/project.test.ts

Tests
14 passed

Evidence
corroborated
```

这样 Brain 看到的是实际发生了什么，而不只是 Harness 自己写的一段总结。

---

## 关于省 Token

Agent2LLM 的目标之一，是减少重复上下文和重复规划。

但现在不会写一个没有依据的：

```text
节省 80% Token
```

Agent2LLM 会区分：

- Provider 真正返回的用量；
- 文本大小估算；
- 执行次数；
- Evidence 压缩；
- 无法获取的用量。

Codex、Claude Code 等 Harness 可能在内部使用自己的模型、订阅或者额度。

如果 Agent2LLM 看不到这些数据，就应该显示“不可用”，而不是假装它等于 0。

真正有意义的测试应该是：

> 给普通 Coding Agent 和「长期 Brain + 聚焦执行 Harness」同一个任务，然后比较上下文、轮次、耗时、人工干预和成功结果。

这部分还在继续验证。

---

## 两种工作流

Agent2LLM 目前保留两种模式。

### Relay

现在主要发展的模式。

```text
Brain
  ↓
下一步
  ↓
Harness
  ↓
Evidence
  ↓
同一个 Brain
```

适合一个长期 Brain 连续处理很多小任务。

### Brain / Hands

项目早期的工作流。

适合让 Brain 更直接地查看 Workspace，并围绕单次 Run 做完整规划和审阅。

Relay 是目前主要的产品方向，但旧工作流仍然保留。

---

## 常用命令

```bash
a2l doctor
a2l adapters

a2l pair create --brain chatgpt-web --harness codex
a2l pair list
a2l pair show

a2l run "你的目标"

a2l dock
a2l dock shortcut --remove

a2l report
a2l logs
```

设备 / Bridge 配对使用：

```bash
a2l bridge pair
a2l bridge unpair
```

完整命令可以查看：

```bash
a2l --help
```

---

## 当前状态

Agent2LLM 仍然处于快速开发阶段。

目前已经有：

- 持久化的 Brain × Harness Pair；
- Relay 工作流；
- 面向执行的 Harness Task；
- Repository Evidence；
- 持久 Brain Conversation；
- 本地 Dock，会自动打开自己的窗口；
- 全局安装时创建的桌面 Dock 快捷方式；
- Adapter 检测，区分现在可用和需要配置；
- 用量与效率统计；
- 真实 Provider E2E 验证链路。

0.3.1 和 0.3.2 两次迭代集中在桌面体验：Dock 会自动打开，全局安装时会创建桌面快捷方式。

但并不是所有 Adapter 组合都已经在所有真实环境跑通。

登录状态、Provider 额度、网页和桌面端差异，以及第三方工具自身行为都会影响真实结果。

这些失败应该被保留下来，而不是包装成成功。

真实开发记录见：

[CHANGELOG.md](./CHANGELOG.md)

---

## 知行

Agent2LLM 的理念最后其实只有三句话：

> **对话属于 Brain。**  
> **执行属于 Harness。**  
> **Agent2LLM 负责让它们持续协作。**

如果用中文表达：

**知 · 行**

知，负责想清楚。

行，负责真正做出来。

---

## 参与贡献

欢迎提交 Issue、Adapter、测试、文档和真实环境验证。

可以从这里开始：

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [AGENTS.md](./AGENTS.md)
- [docs/](./docs/)
- [CHANGELOG.md](./CHANGELOG.md)

新增 Brain 或 Harness 时，尽量把不同 Provider 的特殊逻辑留在 Adapter 边界内。

---

## License

MIT。

开放开发。

每一个产品声明，都应该能够被验证。
