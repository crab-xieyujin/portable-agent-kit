# Portable Agent Kit

Language: [English](#english) | [中文](#中文)

---

## English

Portable Agent Kit is a small CLI and package format for copying an AI agent across different platforms.

It solves a common migration problem: an agent works well in one platform, such as Codex, but behaves differently after being moved elsewhere because hidden platform skills were not copied.

The kit makes those hidden dependencies explicit:

- instructions: how the agent behaves
- skills: what the agent knows how to do
- capabilities: what platform powers the skill needs
- toolchain: which reusable resources and fallback implementations the skill should reuse
- assets and fallbacks: references, templates, examples, scripts, and manual procedures that travel with the agent
- adapters: how each platform maps or degrades those capabilities
- evals: how to test whether the copied agent still behaves correctly

### Install

From this folder during development:

```bash
npm install
npm link
```

Then use:

```bash
portable-agent --help
pak --help
```

After publishing to npm, users can install it globally:

```bash
npm install -g portable-agent-kit
```

Or run it with npx:

```bash
npx portable-agent-kit init
```

### Quick Start

Create a portable agent package:

```bash
portable-agent init
```

This creates:

```txt
agent/
  agent.json
  identity.md
  soul.md
  instructions.md
  workflow.md
  tools.md
  memory.md
  capabilities.json
  toolchain.json
  skills/
  assets/
  fallbacks/
  evals/
```

Check compatibility with a target platform:

```bash
portable-agent doctor
portable-agent doctor --target codex
portable-agent doctor --target openclaw
portable-agent doctor --target claude
portable-agent doctor --target accio-work
portable-agent doctor --target wukong
portable-agent doctor --target workbuddy
```

Export a platform-specific package:

```bash
portable-agent export
portable-agent export --target codex
portable-agent export --target openclaw
portable-agent export --target claude
portable-agent export --target accio-work
portable-agent export --target wukong
portable-agent export --target workbuddy
```

Generated files are written to:

```txt
dist/<target>/
```

If `--target` is omitted in an interactive terminal, the CLI shows a platform picker. Use Up/Down arrows and press Enter to confirm. In non-interactive scripts or CI, pass `--target` explicitly; the CLI prints the same choices and an example command instead of waiting for keyboard input.

### How Others Use Your Agent

You publish or share a repository that contains:

```txt
agent/
  agent.json
  identity.md
  soul.md
  instructions.md
  workflow.md
  tools.md
  memory.md
  capabilities.json
  toolchain.json
  skills/
  assets/
  fallbacks/
  evals/
```

Another user clones it:

```bash
git clone https://github.com/you/my-agent
cd my-agent
npm install -g portable-agent-kit
portable-agent doctor --target wukong
portable-agent export --target wukong
```

They then open `dist/wukong/setup-guide.md` and create the Wukong agent manually using the generated role prompt, skill cards, fallback notes, and smoke tests.

For platforms that support file-based agents, such as Codex-like coding agents, they can use generated files directly:

```txt
dist/codex/AGENTS.md
dist/claude/CLAUDE.md
dist/openclaw/AGENTS.md
dist/openclaw/SOUL.md
dist/openclaw/IDENTITY.md
dist/openclaw/USER.md
dist/openclaw/TOOLS.md
```

OpenClaw exports are full workspace-shaped packages. They include the core bootstrap files expected by OpenClaw tooling plus copied workspace-owned skills under `dist/openclaw/skills/`. You can run `clawpacker inspect`, `clawpacker validate`, or `clawpacker export` against that generated workspace when the Clawpacker CLI is installed.

### Why Not Just Copy the Prompt?

Because many agent behaviors depend on platform-native abilities:

- reading files
- searching the workspace
- running shell commands
- editing patches
- browsing pages
- calling MCP tools
- using persistent memory

If those abilities are missing on the target platform, the copied prompt may look right but behave differently.

Portable Agent Kit treats those abilities as a capability contract.

Example:

```json
{
  "filesystem.search": {
    "required": true,
    "usedBy": ["codebase-reading", "debugging"],
    "fallbacks": ["shell_rg", "python_text_search", "manual_index"],
    "riskIfMissing": "high"
  }
}
```

This lets the CLI report whether the target platform supports the skill, degrades it, or cannot run it.

### Commands

#### init

Create a sample portable agent package.

```bash
portable-agent init
portable-agent init --agent my-agent
portable-agent init --type coding
portable-agent init --type writer
portable-agent init --type presales
portable-agent init --type architect
portable-agent init --agent my-agent --force
```

#### doctor

Check whether a target platform can support the agent.

```bash
portable-agent doctor
portable-agent doctor --target codex
portable-agent doctor --target openclaw
portable-agent doctor --target claude
portable-agent doctor --target accio-work
portable-agent doctor --target wukong
portable-agent doctor --target workbuddy
```

#### export

Generate platform-specific setup files.

```bash
portable-agent export
portable-agent export --target codex
portable-agent export --target openclaw
portable-agent export --target claude
portable-agent export --target wukong --out exported/wukong
portable-agent export --target workbuddy
```

### Package Shape

```txt
agent/
  agent.json
  identity.md
  soul.md
  instructions.md
  workflow.md
  user.md
  tools.md
  memory.md
  capabilities.json
  toolchain.json
  skills/
    codebase-reading.md
    agent-portability-auditor.md
  assets/
    references/
    templates/
  fallbacks/
  evals/
    smoke-tests.md
```

The optional core files let one source package export richer workspace-shaped agents:

- `identity.md`: short external identity card
- `soul.md`: stable judgment, truths, and boundaries
- `workflow.md`: default task flow and output tendencies
- `user.md`: user profile slots, not task logs
- `tools.md`: role-specific environment and tool preferences
- `memory.md`: long-term memory structure
- `toolchain.json`: reusable toolchain contracts that connect skills to packaged assets and fallbacks
- `assets/`: references, templates, examples, and other reusable resources
- `fallbacks/`: scripts or manual procedures to reuse when a target platform lacks native support

Exports copy shared resources to `skills/_shared/` and generate `tool-migration-report.md`. Target agents should check `skills/_shared/TOOLCHAIN.md`, `references/`, `templates/`, and `fallbacks/` before writing new parsing, export, browser, or automation scripts.

### Platform Adapters

Adapters live in:

```txt
adapters/
  codex/adapter.json
  openclaw/adapter.json
  claude/adapter.json
  accio-work/adapter.json
  wukong/adapter.json
  workbuddy/adapter.json
```

Each adapter describes how the target platform supports capabilities:

```json
{
  "supports": {
    "filesystem.read": "native_workspace_read",
    "shell.run": "none",
    "patch.edit": "none"
  }
}
```

Support values are intentionally plain strings. This keeps adapters easy to edit while the ecosystem is still changing.

### Fallback Scripts

The `fallbacks/` folder contains simple scripts that can be copied into platforms with code execution but without native search:

```txt
fallbacks/file_reader.py
fallbacks/text_search.py
```

These are not meant to replace platform-native tools. They are safety nets for degraded migrations.

### Recommended Workflow

1. Put stable agent rules in `agent/instructions.md`.
2. Move reusable behavior into `agent/skills/*.md`.
3. Put reusable references, templates, and fallback scripts in `agent/assets/` and `agent/fallbacks/`.
4. Describe those resources in `agent/toolchain.json` so exported agents know what to reuse.
5. Add required platform capabilities to `agent/capabilities.json`.
6. Run `portable-agent doctor --target <platform>`.
7. Run `portable-agent export --target <platform>`.
8. Run the smoke tests in `dist/<platform>/evals`.

### Current Targets

- Codex
- OpenClaw
- Claude
- Accio Work
- Wukong
- WorkBuddy

OpenClaw exports are full workspace-shaped packages. They include `AGENTS.md`, `IDENTITY.md`, `SOUL.md`, `BOOTSTRAP.md`, `USER.md`, `TOOLS.md`, `MEMORY.md`, `HEARTBEAT.md`, `.openclaw/workspace-state.json`, copied `skills/`, `skills/_shared/` resources, setup notes, toolchain migration notes, and a compatibility report. OpenClaw runtime files are generated with Chinese operating text by default while preserving paths, capability keys, and user-provided source content. Claude exports include `CLAUDE.md`. Accio Work, Wukong, and WorkBuddy exports are setup guides because public, stable file-import formats are not assumed. If those platforms later expose import APIs or package formats, add new adapter renderers in `src/cli.js`.

### Roadmap

- YAML support
- More platform adapters
- MCP manifest generation
- Eval runner
- Adapter schema validation
- Import from existing AGENTS.md or skill folders

### License

MIT

---

## 中文

Portable Agent Kit 是一个轻量 CLI 和 Agent 迁移包格式，用来把一个 AI Agent 复制到不同平台。

它解决的是一个常见迁移问题：你的 Agent 在 Codex 这类平台里表现稳定，但迁移到别的平台后行为变了，因为很多平台自带能力和隐藏依赖没有被一起复制过去。

这个工具会把这些隐藏依赖显式化：

- instructions：Agent 的行为规则
- skills：Agent 会做哪些任务
- capabilities：这些 skill 依赖哪些平台能力
- toolchain：这些 skill 应复用哪些资料、模板和 fallback 实现
- assets 和 fallbacks：随 Agent 一起迁移的规则、模板、样例、脚本和人工流程
- adapters：不同平台如何支持或降级这些能力
- evals：迁移后如何验收 Agent 是否仍然按预期工作

### 安装

开发阶段，在当前项目目录里运行：

```bash
npm install
npm link
```

然后可以使用：

```bash
portable-agent --help
pak --help
```

发布到 npm 后，用户可以全局安装：

```bash
npm install -g portable-agent-kit
```

也可以用 npx 直接运行：

```bash
npx portable-agent-kit init
```

### 快速开始

创建一个可迁移 Agent 包：

```bash
portable-agent init
```

它会生成：

```txt
agent/
  agent.json
  identity.md
  soul.md
  instructions.md
  workflow.md
  tools.md
  memory.md
  capabilities.json
  toolchain.json
  skills/
  assets/
  fallbacks/
  evals/
```

检查目标平台兼容性：

```bash
portable-agent doctor
portable-agent doctor --target codex
portable-agent doctor --target openclaw
portable-agent doctor --target claude
portable-agent doctor --target accio-work
portable-agent doctor --target wukong
portable-agent doctor --target workbuddy
```

导出目标平台配置包：

```bash
portable-agent export
portable-agent export --target codex
portable-agent export --target openclaw
portable-agent export --target accio-work
portable-agent export --target wukong
portable-agent export --target workbuddy
```

生成文件会写入：

```txt
dist/<target>/
```

如果在交互式终端里省略 `--target`，CLI 会显示平台选择器，可以用上下键选择并按 Enter 确认；如果在脚本或 CI 里运行，请显式传入 `--target`，CLI 会打印同一组选项和示例命令，不会等待键盘输入。

### 别人如何使用你的 Agent

你发布或分享一个包含以下内容的仓库：

```txt
agent/
  agent.json
  instructions.md
  capabilities.json
  skills/
  evals/
```

别人克隆之后运行：

```bash
git clone https://github.com/you/my-agent
cd my-agent
npm install -g portable-agent-kit
portable-agent doctor --target wukong
portable-agent export --target wukong
```

然后打开 `dist/wukong/setup-guide.md`，按照生成的角色提示词、skill 卡片、降级说明和验收测试，在 Wukong 里手动创建 Agent。

对于支持文件式配置的开发者 Agent 平台，可以直接使用生成文件：

```txt
dist/codex/AGENTS.md
dist/claude/CLAUDE.md
dist/openclaw/AGENTS.md
dist/openclaw/SOUL.md
dist/openclaw/IDENTITY.md
dist/openclaw/USER.md
dist/openclaw/TOOLS.md
```

### 为什么不能只复制 Prompt？

因为很多 Agent 行为依赖平台原生能力：

- 读取文件
- 搜索工作区
- 运行 shell 命令
- 应用代码补丁
- 浏览网页
- 调用 MCP 工具
- 使用持久记忆

如果目标平台缺少这些能力，只复制 prompt 看起来像迁移成功了，但行为会明显不同。

Portable Agent Kit 把这些能力视为一份 capability contract。

示例：

```json
{
  "filesystem.search": {
    "required": true,
    "usedBy": ["codebase-reading", "debugging"],
    "fallbacks": ["shell_rg", "python_text_search", "manual_index"],
    "riskIfMissing": "high"
  }
}
```

这样 CLI 就能判断目标平台是完整支持、降级支持，还是无法运行某个 skill。

### 命令

#### init

创建一个示例 Agent 迁移包。

```bash
portable-agent init
portable-agent init --agent my-agent
portable-agent init --type coding
portable-agent init --type writer
portable-agent init --type presales
portable-agent init --type architect
portable-agent init --agent my-agent --force
```

#### doctor

检查目标平台是否能支持这个 Agent。

```bash
portable-agent doctor
portable-agent doctor --target codex
portable-agent doctor --target openclaw
portable-agent doctor --target accio-work
portable-agent doctor --target wukong
portable-agent doctor --target workbuddy
```

#### export

生成目标平台专用配置文件。

```bash
portable-agent export
portable-agent export --target codex
portable-agent export --target openclaw
portable-agent export --target claude
portable-agent export --target wukong --out exported/wukong
portable-agent export --target workbuddy
```

### 迁移包结构

```txt
agent/
  agent.json
  identity.md
  soul.md
  instructions.md
  workflow.md
  user.md
  tools.md
  memory.md
  capabilities.json
  toolchain.json
  skills/
    codebase-reading.md
    agent-portability-auditor.md
  assets/
    references/
    templates/
  fallbacks/
  evals/
    smoke-tests.md
```

这些可选核心文件用于导出更完整的工作区型 Agent：

- `identity.md`：极简身份卡
- `soul.md`：长期稳定的判断、真话和边界
- `workflow.md`：默认任务流程和产出倾向
- `user.md`：用户画像槽位，不放任务流水
- `tools.md`：角色专属环境和工具偏好
- `memory.md`：长期记忆结构
- `toolchain.json`：把 skill 和可复用资料、模板、fallback 脚本关联起来的工具链契约
- `assets/`：规则、参考资料、样例、模板等可复用资源
- `fallbacks/`：目标平台缺少原生能力时优先复用的脚本或人工流程

导出包会把共享资源复制到 `skills/_shared/`，并生成 `tool-migration-report.md`。目标 Agent 应先检查 `skills/_shared/TOOLCHAIN.md`、`references/`、`templates/`、`fallbacks/`，再决定是否新写解析、导出、浏览或自动化脚本。

### 平台适配器

适配器位于：

```txt
adapters/
  codex/adapter.json
  openclaw/adapter.json
  accio-work/adapter.json
  wukong/adapter.json
  workbuddy/adapter.json
```

每个适配器描述目标平台如何支持各类能力：

```json
{
  "supports": {
    "filesystem.read": "native_workspace_read",
    "shell.run": "none",
    "patch.edit": "none"
  }
}
```

支持状态目前使用普通字符串，这样在平台生态快速变化时更容易维护。

### 降级脚本

`fallbacks/` 目录包含一些简单脚本，适合复制到支持代码执行但没有原生搜索的平台：

```txt
fallbacks/file_reader.py
fallbacks/text_search.py
```

这些脚本不是用来替代平台原生工具，而是迁移降级时的兜底方案。

### 推荐工作流

1. 把稳定的 Agent 规则放到 `agent/instructions.md`。
2. 把可复用行为拆到 `agent/skills/*.md`。
3. 把可复用规则、模板和 fallback 脚本放到 `agent/assets/` 和 `agent/fallbacks/`。
4. 在 `agent/toolchain.json` 里声明这些资源对应哪些 skill 和工具链。
5. 在 `agent/capabilities.json` 里声明每个 skill 依赖的平台能力。
6. 运行 `portable-agent doctor --target <platform>`。
7. 运行 `portable-agent export --target <platform>`。
8. 用 `dist/<platform>/evals` 里的测试题验收迁移结果。

### 当前支持目标

- Codex
- OpenClaw
- Accio Work
- Wukong
- WorkBuddy

OpenClaw 会导出完整工作区包，包括 `AGENTS.md`、`IDENTITY.md`、`SOUL.md`、`BOOTSTRAP.md`、`USER.md`、`TOOLS.md`、`MEMORY.md`、`HEARTBEAT.md`、`.openclaw/workspace-state.json`、复制后的 `skills/`、`skills/_shared/` 资源、安装说明、工具链迁移说明和兼容性报告。OpenClaw 运行文件默认使用中文操作说明，同时保留路径、能力 key 和用户自定义源内容。Accio Work、Wukong 和 WorkBuddy 目前导出的是 setup guide，因为这里不假设它们已经有公开稳定的文件导入格式。如果这些平台之后开放导入 API 或 Agent package 格式，可以在 `src/cli.js` 里增加新的 adapter renderer。

### 路线图

- YAML 支持
- 更多平台适配器
- MCP manifest 生成
- Eval runner
- Adapter schema 校验
- 从已有 `AGENTS.md` 或 skill 目录导入

### 许可证

MIT
