#!/usr/bin/env node
import { mkdir, readFile, writeFile, readdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { emitKeypressEvents } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = ["codex", "openclaw", "claude", "accio-work", "wukong", "workbuddy"];

const TARGET_GUIDANCE = {
  codex: "Codex project instructions with AGENTS.md",
  openclaw: "OpenClaw workspace package with identity, soul, memory, bootstrap, and state files",
  claude: "Claude-family project instructions with CLAUDE.md",
  "accio-work": "Accio Work manual setup guide and skill cards",
  wukong: "Wukong manual setup guide and skill cards",
  workbuddy: "WorkBuddy manual setup guide and skill cards"
};

const CAPABILITY_LABELS = {
  "filesystem.read": "Read files from a workspace or uploaded documents",
  "filesystem.search": "Search text across many files",
  "shell.run": "Run shell commands or scripts",
  "browser.use": "Open and inspect web pages",
  "git.inspect": "Read Git history, status, branches, and diffs",
  "patch.edit": "Apply precise code edits",
  "mcp.use": "Connect external tools through MCP",
  "memory.persist": "Persist long-lived memory across sessions"
};

const CAPABILITY_LABELS_ZH = {
  "filesystem.read": "读取工作区文件或上传文档",
  "filesystem.search": "跨文件搜索文本",
  "shell.run": "运行命令或脚本",
  "browser.use": "打开并检查网页",
  "git.inspect": "读取 Git 历史、状态、分支和差异",
  "patch.edit": "应用精确代码修改",
  "mcp.use": "通过 MCP 连接外部工具",
  "memory.persist": "跨会话持久化长期记忆"
};

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const args = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (item.startsWith("--")) {
      const key = item.slice(2);
      const next = rest[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      args._.push(item);
    }
  }
  return { command, args };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readOptionalJson(file, fallback) {
  return existsSync(file) ? readJson(file) : fallback;
}

async function readText(file) {
  return readFile(file, "utf8");
}

async function readOptionalText(file) {
  return existsSync(file) ? readText(file) : "";
}

async function writeText(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

async function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return names.filter((name) => name.endsWith(".md")).sort();
}

async function listFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function bodyWithoutTitle(markdown, title) {
  const trimmed = markdown.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\r?\n/);
  if (lines[0].trim().toLowerCase() === `# ${title}`.toLowerCase()) {
    return lines.slice(1).join("\n").trim();
  }
  return trimmed;
}

function normalizeRelativePath(value) {
  return String(value).replace(/\\/g, "/").replace(/\/$/, "");
}

function getToolchainTools(toolchain) {
  return toolchain.tools || toolchain.toolchain || {};
}

function collectToolchainPaths(toolchain, key) {
  const paths = new Set();
  for (const spec of Object.values(getToolchainTools(toolchain))) {
    for (const item of spec[key] || []) {
      const normalized = normalizeRelativePath(item);
      if (normalized.includes("*")) continue;
      paths.add(normalized);
    }
  }
  return [...paths].sort();
}

function validateToolchainReferences(loaded) {
  const missing = [];
  for (const item of collectToolchainPaths(loaded.toolchain, "assets")) {
    if (!existsSync(path.join(loaded.agentDir, item))) missing.push(item);
  }
  for (const item of collectToolchainPaths(loaded.toolchain, "fallbacks")) {
    if (!existsSync(path.join(loaded.agentDir, item))) missing.push(item);
  }
  if (missing.length) {
    throw new Error(`toolchain.json references missing files or directories: ${missing.join(", ")}`);
  }
}

function mapSharedAssetTarget(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (normalized.startsWith("assets/")) return normalized.slice("assets/".length);
  if (normalized.startsWith("fallbacks/")) return normalized;
  return normalized;
}

function normalizeExportedSkillBody(body) {
  return body
    .replace(/skill[\\/]+references[\\/]+/g, "skills/_shared/references/")
    .replace(/skill[\\/]+templates[\\/]+/g, "skills/_shared/templates/")
    .replace(/skill[\\/]+([^/\\\s`]+)[\\/]+SKILL\.md/g, "skills/$1.md");
}

async function readExportedSkillBody(loaded, file) {
  const body = await readText(path.join(loaded.agentDir, "skills", file));
  return normalizeExportedSkillBody(body);
}

async function writeExportedSkills(outDir, loaded) {
  if (!loaded.skillFiles.length) return;
  for (const file of loaded.skillFiles) {
    const body = await readExportedSkillBody(loaded, file);
    await writeText(path.join(outDir, "skills", file), body.trimEnd() + "\n");
  }
}

function resolveAgentDir(args) {
  return path.resolve(ROOT, args.agent || "agent");
}

async function loadAgent(agentDir) {
  const agentFile = path.join(agentDir, "agent.json");
  const capabilitiesFile = path.join(agentDir, "capabilities.json");
  if (!existsSync(agentFile)) {
    throw new Error(`Missing ${agentFile}. Run "portable-agent init" first.`);
  }
  if (!existsSync(capabilitiesFile)) {
    throw new Error(`Missing ${capabilitiesFile}.`);
  }
  const assetsDir = path.join(agentDir, "assets");
  const fallbacksDir = path.join(agentDir, "fallbacks");
  const loaded = {
    agentDir,
    agent: await readJson(agentFile),
    capabilities: await readJson(capabilitiesFile),
    toolchain: await readOptionalJson(path.join(agentDir, "toolchain.json"), { tools: {} }),
    identity: await readOptionalText(path.join(agentDir, "identity.md")),
    soul: await readOptionalText(path.join(agentDir, "soul.md")),
    instructions: await readOptionalText(path.join(agentDir, "instructions.md")),
    workflow: await readOptionalText(path.join(agentDir, "workflow.md")),
    user: await readOptionalText(path.join(agentDir, "user.md")),
    tools: await readOptionalText(path.join(agentDir, "tools.md")),
    memory: await readOptionalText(path.join(agentDir, "memory.md")),
    skillFiles: await listMarkdown(path.join(agentDir, "skills")),
    assetsDir,
    fallbacksDir,
    assetFiles: await listFilesRecursive(assetsDir),
    fallbackFiles: await listFilesRecursive(fallbacksDir)
  };
  validateToolchainReferences(loaded);
  return loaded;
}

async function loadAdapter(target) {
  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown target "${target}". Supported: ${TARGETS.join(", ")}`);
  }
  return readJson(path.join(KIT_ROOT, "adapters", target, "adapter.json"));
}

function renderTargetOptions() {
  return TARGETS.map((target, index) => {
    return `${index + 1}. ${target} - ${TARGET_GUIDANCE[target]}`;
  }).join("\n");
}

async function selectTargetWithKeyboard() {
  return new Promise((resolve, reject) => {
    let selected = 0;
    let rendered = false;
    const input = process.stdin;
    const output = process.stdout;
    const previousRawMode = input.isRaw;

    function render() {
      if (rendered) {
        output.write(`\x1b[${TARGETS.length}A\x1b[0J`);
      }
      for (let index = 0; index < TARGETS.length; index += 1) {
        const target = TARGETS[index];
        const marker = index === selected ? ">" : " ";
        output.write(`${marker} ${target} - ${TARGET_GUIDANCE[target]}\n`);
      }
      rendered = true;
    }

    function cleanup() {
      input.off("keypress", onKeypress);
      if (input.isTTY && typeof input.setRawMode === "function") {
        input.setRawMode(previousRawMode);
      }
      input.pause();
      output.write("\x1b[?25h");
    }

    function onKeypress(_text, key = {}) {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Target selection cancelled."));
        return;
      }
      if (key.name === "up") {
        selected = selected === 0 ? TARGETS.length - 1 : selected - 1;
        render();
        return;
      }
      if (key.name === "down") {
        selected = selected === TARGETS.length - 1 ? 0 : selected + 1;
        render();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        const target = TARGETS[selected];
        cleanup();
        output.write(`Selected: ${target}\n`);
        resolve(target);
        return;
      }
      const numeric = Number(key.sequence);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= TARGETS.length) {
        selected = numeric - 1;
        render();
      }
    }

    output.write("Which platform should this agent be adapted for?\n");
    output.write("Use Up/Down arrows and press Enter to confirm.\n\n");
    output.write("\x1b[?25l");
    emitKeypressEvents(input);
    if (input.isTTY && typeof input.setRawMode === "function") {
      input.setRawMode(true);
    }
    input.resume();
    input.on("keypress", onKeypress);
    render();
  });
}

async function resolveTarget(args, command) {
  if (args.target) return args.target;
  const agentHint = args.agent ? ` --agent ${args.agent}` : "";
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `Missing --target for ${command}. Choose one:\n${renderTargetOptions()}\n` +
      `Example: portable-agent ${command} --target openclaw${agentHint}`
    );
  }

  return selectTargetWithKeyboard();
}

function scoreSupport(value) {
  if (!value || value === "none" || value === "unknown") return 0;
  if (
    value.startsWith("manual") ||
    value.startsWith("upload") ||
    value.includes("fallback") ||
    value.includes("limited") ||
    value.includes("none_or") ||
    value.includes("or_none")
  ) return 0.5;
  return 1;
}

function analyzeCompatibility(capabilities, adapter) {
  const rows = Object.entries(capabilities.capabilities).map(([name, spec]) => {
    const support = adapter.supports[name] || "unknown";
    const score = scoreSupport(support);
    const required = spec.required === true;
    const status = score === 1 ? "supported" : score > 0 ? "degraded" : required ? "missing" : "optional-missing";
    return {
      name,
      label: CAPABILITY_LABELS[name] || name,
      required,
      support,
      status,
      usedBy: spec.usedBy || [],
      fallbacks: spec.fallbacks || [],
      risk: spec.riskIfMissing || (required ? "high" : "medium")
    };
  });
  const requiredRows = rows.filter((row) => row.required);
  const total = requiredRows.length || rows.length || 1;
  const points = (requiredRows.length ? requiredRows : rows).reduce((sum, row) => {
    return sum + (row.status === "supported" ? 1 : row.status === "degraded" ? 0.5 : 0);
  }, 0);
  return { rows, percent: Math.round((points / total) * 100) };
}

function renderDoctor(agent, adapter, report) {
  const lines = [];
  lines.push(`${agent.name} -> ${adapter.name}`);
  lines.push(`Compatibility: ${report.percent}%`);
  lines.push("");
  if (adapter.workspaceContract) {
    lines.push("WORKSPACE CONTRACT");
    if (adapter.workspaceContract.requiredFiles?.length) {
      lines.push(`- required files: ${adapter.workspaceContract.requiredFiles.join(", ")}`);
    }
    if (adapter.workspaceContract.skillDirectory) {
      lines.push(`- skill directory: ${adapter.workspaceContract.skillDirectory}`);
    }
    if (adapter.workspaceContract.packageTool) {
      lines.push(`- package tool: ${adapter.workspaceContract.packageTool}`);
    }
    lines.push("");
  }
  for (const group of ["missing", "degraded", "supported", "optional-missing"]) {
    const rows = report.rows.filter((row) => row.status === group);
    if (!rows.length) continue;
    lines.push(group.toUpperCase());
    for (const row of rows) {
      lines.push(`- ${row.name}: ${row.support}`);
      if (row.usedBy.length) lines.push(`  used by: ${row.usedBy.join(", ")}`);
      if (row.fallbacks.length && group !== "supported") lines.push(`  fallback: ${row.fallbacks.join(" -> ")}`);
      if (group === "missing") lines.push(`  risk: ${row.risk}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

async function initCommand(args) {
  const targetDir = resolveAgentDir(args);
  const type = args.type || "generic";
  const supportedTypes = ["generic", "coding", "writer", "presales", "architect"];
  if (!supportedTypes.includes(type)) {
    throw new Error(`Unknown agent type "${type}". Supported: ${supportedTypes.join(", ")}`);
  }
  if (existsSync(targetDir) && !args.force) {
    throw new Error(`${targetDir} already exists. Use --force to overwrite the sample agent folder.`);
  }
  if (existsSync(targetDir) && args.force) {
    await rm(targetDir, { recursive: true, force: true });
  }
  await cp(path.join(KIT_ROOT, "templates", "agent"), targetDir, { recursive: true });
  await writeAgentTypeFiles(targetDir, type);
  console.log(`Created portable agent package at ${targetDir}`);
  console.log(`Agent type: ${type}`);
  console.log("");
  console.log("Next: choose the platform you want to adapt this agent for:");
  console.log(renderTargetOptions());
  console.log("");
  console.log(`Run: portable-agent doctor --target <platform> --agent ${path.relative(ROOT, targetDir)}`);
}

async function doctorCommand(args) {
  const target = await resolveTarget(args, "doctor");
  const loaded = await loadAgent(resolveAgentDir(args));
  const adapter = await loadAdapter(target);
  const report = analyzeCompatibility(loaded.capabilities, adapter);
  console.log(renderDoctor(loaded.agent, adapter, report));
}

async function exportCommand(args) {
  const target = await resolveTarget(args, "export");
  const loaded = await loadAgent(resolveAgentDir(args));
  const adapter = await loadAdapter(target);
  const report = analyzeCompatibility(loaded.capabilities, adapter);
  const outDir = path.resolve(ROOT, args.out || path.join("dist", target));
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const setup = await renderSetupGuide(loaded, adapter, report);
  await writeText(path.join(outDir, "setup-guide.md"), setup);

  if (target === "codex") {
    await writeText(path.join(outDir, "AGENTS.md"), renderCodexAgents(loaded, report));
  } else if (target === "openclaw") {
    await writeOpenClawWorkspace(outDir, loaded, report);
  } else if (target === "claude") {
    await writeText(path.join(outDir, "CLAUDE.md"), renderClaudeMd(loaded, report));
  } else {
    await writeText(path.join(outDir, "skill-cards.md"), await renderSkillCards(loaded));
  }

  if (target !== "openclaw") {
    await copySourceSkills(outDir, loaded);
  }
  await writeSharedToolchain(outDir, loaded, adapter, report);
  await validateExportedSkillPathReferences(outDir, loaded);
  await writeText(path.join(outDir, "compatibility-report.md"), renderDoctor(loaded.agent, adapter, report) + "\n");
  if (existsSync(path.join(loaded.agentDir, "evals"))) {
    await cp(path.join(loaded.agentDir, "evals"), path.join(outDir, "evals"), { recursive: true });
  }
  console.log(`Exported ${target} package to ${outDir}`);
}

async function copySourceSkills(outDir, loaded) {
  await writeExportedSkills(outDir, loaded);
}

async function writeSharedToolchain(outDir, loaded, adapter, report) {
  const sharedDir = path.join(outDir, "skills", "_shared");
  const hasToolchain = Object.keys(getToolchainTools(loaded.toolchain)).length > 0;
  const hasSharedFiles = loaded.assetFiles.length > 0 || loaded.fallbackFiles.length > 0;
  if (!hasToolchain && !hasSharedFiles) return;

  for (const file of loaded.assetFiles) {
    const relative = path.relative(loaded.agentDir, file);
    const target = path.join(sharedDir, mapSharedAssetTarget(relative));
    await mkdir(path.dirname(target), { recursive: true });
    await cp(file, target, { recursive: true });
  }
  for (const file of loaded.fallbackFiles) {
    const relative = path.relative(loaded.agentDir, file);
    const target = path.join(sharedDir, mapSharedAssetTarget(relative));
    await mkdir(path.dirname(target), { recursive: true });
    await cp(file, target, { recursive: true });
  }

  const reportBody = renderToolchainReport(loaded, adapter, report);
  await writeText(path.join(sharedDir, "TOOLCHAIN.md"), reportBody);
  await writeText(path.join(outDir, "tool-migration-report.md"), reportBody);
}

async function writeAgentTypeFiles(agentDir, type) {
  const presets = {
    generic: {
      identity: "A portable agent that keeps behavior, capabilities, skills, and evals explicit across platforms.",
      soulTruths: [
        "A portable agent is only as reliable as the files and checks that move with it.",
        "Hidden platform assumptions must be named before they shape the answer.",
        "A fallback is a degraded route, not the same capability under a different name."
      ],
      workflow: [
        "Understand the request, target platform, and available files.",
        "Check required capabilities before claiming a tool or workflow.",
        "Execute the smallest verifiable step, then report evidence and gaps."
      ],
      memorySlots: ["Platform differences", "Migration learnings", "Reusable validation checks"]
    },
    coding: {
      identity: "A coding agent focused on reading, editing, testing, and shipping software changes.",
      soulTruths: [
        "Code changes are not complete until they are checked against the surrounding system.",
        "Existing user work is part of the system and must be preserved.",
        "Small, verified patches beat broad rewrites."
      ],
      workflow: [
        "Read the relevant code and project scripts.",
        "Make a focused change that matches local patterns.",
        "Run the narrowest useful verification, then expand when risk requires it."
      ],
      memorySlots: ["Project conventions", "Test commands", "Known failure modes"]
    },
    writer: {
      identity: "A writing agent focused on planning, drafting, editing, and publishing structured content.",
      soulTruths: [
        "Good writing starts with audience, promise, and shape before wording.",
        "A draft should preserve the user's intent while making the structure easier to trust.",
        "Style is useful only when it serves clarity and distribution."
      ],
      workflow: [
        "Clarify audience, goal, channel, and constraints.",
        "Build an outline before expanding prose.",
        "Edit for structure, rhythm, factual risk, and final channel fit."
      ],
      memorySlots: ["Audience profile", "Style rules", "High-performing topics"]
    },
    presales: {
      identity: "A presales agent focused on discovery, demos, POCs, competitive positioning, and deal support.",
      soulTruths: [
        "A demo is not a product tour; it is a proof that the buyer's problem can be solved.",
        "Technical detail must connect back to business value, risk, or adoption friction.",
        "Do not make commercial commitments that belong to sales or legal owners."
      ],
      workflow: [
        "Run discovery around buyer role, pain, urgency, and success criteria.",
        "Map capabilities to a narrative demo or POC plan.",
        "Surface risks, competitors, proof points, and next-step artifacts."
      ],
      memorySlots: ["Demo patterns", "POC lessons", "Competitor comparisons"]
    },
    architect: {
      identity: "A solution architecture agent focused on translating requirements into viable technical designs.",
      soulTruths: [
        "Architecture lives at the intersection of business constraints and technical tradeoffs.",
        "A design without non-functional goals is only a diagram.",
        "Every recommendation should expose assumptions and alternatives."
      ],
      workflow: [
        "Collect requirements, constraints, stakeholders, and non-functional goals.",
        "Choose architecture patterns and explain tradeoffs.",
        "Produce delivery artifacts: components, data flow, APIs, risks, and validation plan."
      ],
      memorySlots: ["Architecture patterns", "Customer requirement patterns", "Technology decisions"]
    }
  };
  const preset = presets[type];
  await writeText(path.join(agentDir, "identity.md"), `# Identity

${preset.identity}
`);
  await writeText(path.join(agentDir, "soul.md"), `# Soul

## Truths

${preset.soulTruths.map((item) => `- ${item}`).join("\n")}

## Boundaries

- Do not claim access to capabilities that are not available in the current platform.
- Do not store secrets, credentials, cookies, or session tokens in agent memory files.
- Do not rewrite identity or soul files unless the user explicitly asks to change the agent itself.
`);
  await writeText(path.join(agentDir, "workflow.md"), `# Workflow

${preset.workflow.map((item, index) => `${index + 1}. ${item}`).join("\n")}
`);
  await writeText(path.join(agentDir, "tools.md"), `# Tools

Use this file for role-specific environment preferences, tool endpoints, output formats, and platform notes. Keep capability claims aligned with \`capabilities.json\`.
`);
  await writeText(path.join(agentDir, "user.md"), `# User

## Stable Profile

- Preferred name:
- Role:
- Language:
- Output preferences:

## Slowly Learned Context

-
`);
  await writeText(path.join(agentDir, "memory.md"), `# Memory

## Long-Term Slots

${preset.memorySlots.map((item) => `### ${item}\n\n-`).join("\n\n")}
`);
}

async function renderSetupGuide(loaded, adapter, report) {
  const skills = await Promise.all(
    loaded.skillFiles.map(async (file) => {
      const body = await readExportedSkillBody(loaded, file);
      return `## ${file.replace(/\.md$/, "")}\n\n${body.trim()}`;
    })
  );
  return `# ${loaded.agent.name} Setup Guide for ${adapter.name}

${loaded.agent.description}

## Role Instructions

${loaded.instructions.trim()}

## Platform Compatibility

\`\`\`txt
${renderDoctor(loaded.agent, adapter, report)}
\`\`\`

## Required Setup

${adapter.setup.map((item) => `- ${item}`).join("\n")}

## Skills

${skills.join("\n\n")}

## Toolchain Reuse

${renderToolchainSummary(loaded)}

## Migration Notes

${adapter.notes.map((item) => `- ${item}`).join("\n")}
`;
}

function renderCodexAgents(loaded, report) {
  return `# ${loaded.agent.name}

${loaded.instructions.trim()}

## Portable Agent Capabilities

${report.rows.map((row) => `- ${row.name}: ${row.status} (${row.support})`).join("\n")}

## Working Rules

- Prefer project skills in \`skills/\` when they apply.
- Before writing a new parser, exporter, browser helper, or automation script, check \`skills/_shared/TOOLCHAIN.md\`, \`skills/_shared/fallbacks/\`, \`skills/_shared/references/\`, and \`skills/_shared/templates/\`.
- When a required capability is unavailable, state the missing capability and use the documented fallback.
- Do not pretend a platform-native tool exists when it is not available in the current environment.
`;
}

function renderToolchainSummary(loaded) {
  const tools = getToolchainTools(loaded.toolchain);
  if (!Object.keys(tools).length && !loaded.assetFiles.length && !loaded.fallbackFiles.length) {
    return "未声明共享工具链资源或 fallback 实现。";
  }
  return [
    "本导出包可能在 `skills/_shared/` 下包含可复用工具链资源。",
    "在新写解析、导出、浏览或自动化脚本前，先检查这些文件：",
    "",
    "- `skills/_shared/TOOLCHAIN.md`",
    "- `skills/_shared/references/`",
    "- `skills/_shared/templates/`",
    "- `skills/_shared/fallbacks/`"
  ].join("\n");
}

function renderToolchainReport(loaded, adapter, report) {
  const tools = getToolchainTools(loaded.toolchain);
  const capabilityRows = new Map(report.rows.map((row) => [row.name, row]));
  const lines = [];
  lines.push(`# ${loaded.agent.name} 工具链`);
  lines.push("");
  lines.push("本文件描述随 Agent 一起迁移的可复用资源。在新写解析器、导出器、浏览器辅助脚本、自动化脚本或模板填充脚本前，先检查这里。");
  lines.push("");
  lines.push(`目标平台：${adapter.name}`);
  lines.push("");

  if (loaded.assetFiles.length || loaded.fallbackFiles.length) {
    lines.push("## 已打包的共享资源");
    lines.push("");
    if (loaded.assetFiles.length) {
      lines.push("已复制到 `skills/_shared/` 下的资源：");
      for (const file of loaded.assetFiles) {
        const relative = normalizeRelativePath(path.relative(loaded.agentDir, file));
        lines.push(`- ${mapSharedAssetTarget(relative)}`);
      }
      lines.push("");
    }
    if (loaded.fallbackFiles.length) {
      lines.push("已复制到 `skills/_shared/fallbacks/` 下的 fallback：");
      for (const file of loaded.fallbackFiles) {
        const relative = normalizeRelativePath(path.relative(loaded.agentDir, file));
        lines.push(`- ${mapSharedAssetTarget(relative)}`);
      }
      lines.push("");
    }
  }

  if (!Object.keys(tools).length) {
    lines.push("## 工具契约");
    lines.push("");
    lines.push("未声明 `toolchain.json` 工具契约。");
    return lines.join("\n") + "\n";
  }

  lines.push("## 工具契约");
  lines.push("");
  for (const [name, spec] of Object.entries(tools)) {
    lines.push(`### ${name}`);
    lines.push("");
    if (spec.purpose) lines.push(`用途：${spec.purpose}`);
    if (spec.usedBy?.length) lines.push(`使用方：${spec.usedBy.join(", ")}`);
    if (spec.requires?.length) {
      lines.push("");
      lines.push("| 所需能力 | 当前状态 | 平台支持 |");
      lines.push("|---|---|---|");
      for (const capability of spec.requires) {
        const row = capabilityRows.get(capability);
        lines.push(`| ${capability} | ${row?.status || "unknown"} | ${row?.support || "unknown"} |`);
      }
    }
    if (spec.assets?.length) {
      lines.push("");
      lines.push("已打包资源：");
      for (const item of spec.assets) lines.push(`- ${mapSharedAssetTarget(item)}`);
    }
    if (spec.fallbacks?.length) {
      lines.push("");
      lines.push("可复用 fallback：");
      for (const item of spec.fallbacks) lines.push(`- ${mapSharedAssetTarget(item)}`);
    }
    if (spec.install?.length) {
      lines.push("");
      lines.push("安装或运行说明：");
      for (const item of spec.install) lines.push(`- ${item}`);
    }
    if (spec.whenMissing?.length) {
      lines.push("");
      lines.push("当原生能力缺失时：");
      for (const item of spec.whenMissing) lines.push(`- ${item}`);
    }
    if (spec.riskIfMissing) {
      lines.push("");
      lines.push(`缺失风险：${spec.riskIfMissing}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

async function writeOpenClawWorkspace(outDir, loaded, report) {
  await writeText(path.join(outDir, "AGENTS.md"), renderOpenClawAgents(loaded, report));
  await writeText(path.join(outDir, "SOUL.md"), renderOpenClawSoul(loaded));
  await writeText(path.join(outDir, "IDENTITY.md"), renderOpenClawIdentity(loaded));
  await writeText(path.join(outDir, "USER.md"), renderOpenClawUser(loaded));
  await writeText(path.join(outDir, "TOOLS.md"), renderOpenClawTools(loaded, report));
  await writeText(path.join(outDir, "MEMORY.md"), renderOpenClawMemory(loaded));
  await writeText(path.join(outDir, "BOOTSTRAP.md"), renderOpenClawBootstrap(loaded));
  await writeText(path.join(outDir, "HEARTBEAT.md"), renderOpenClawHeartbeat());
  await writeText(path.join(outDir, ".openclaw", "workspace-state.json"), renderOpenClawWorkspaceState(loaded));
  await writeText(path.join(outDir, "SKILL.md"), renderOpenClawSkillIndex(loaded, report));

  await writeExportedSkills(outDir, loaded);
  validateOpenClawWorkspace(outDir, loaded);
}

function renderOpenClawAgents(loaded, report) {
  return `# ${loaded.agent.name}

${loaded.agent.description}

## 运行环境

这是由 Portable Agent Kit 生成的 OpenClaw 工作区。核心工作区文件是运行契约；迁移说明文件只用于安装、审计和交接，不参与人格定义。

核心运行文件：

- \`AGENTS.md\`：运行手册、启动顺序、能力路由、工作流、记忆规则和边界。
- \`IDENTITY.md\`：极简身份卡。
- \`SOUL.md\`：长期稳定的判断、真话、气质和边界。
- \`BOOTSTRAP.md\`：首次运行引导脚本。
- \`USER.md\`：稳定用户画像和偏好。
- \`TOOLS.md\`：当前工具与能力映射。
- \`MEMORY.md\`：长期记忆结构。
- \`HEARTBEAT.md\`：可选定时任务入口。
- \`.openclaw/workspace-state.json\`：机器可读的生命周期状态。

迁移辅助文件：

- \`setup-guide.md\`：给人看的安装和迁移说明。
- \`compatibility-report.md\`：平台兼容性审计结果。
- \`SKILL.md\`：给需要单一 skill 文档的平台使用的兼容索引。
- \`tool-migration-report.md\`：可复用工具链、资料、fallback 脚本和安装说明。
- \`skills/_shared/\`：共享 references、templates、fallback 实现和 \`TOOLCHAIN.md\`。

## 首次运行

如果 \`.openclaw/workspace-state.json\` 里没有 \`setupCompletedAt\`：

1. 读取 \`BOOTSTRAP.md\`。
2. 只在用户允许的范围内执行首次引导。
3. 将稳定的用户事实写入 \`USER.md\`。
4. 将可复用的工作经验写入 \`MEMORY.md\` 或 \`memory/YYYY-MM-DD.md\`。
5. 首次引导完成后写入 \`setupCompletedAt\`。

除非用户明确要求改变 Agent 本身，否则首次引导不得改写 \`IDENTITY.md\`、\`SOUL.md\` 或 \`AGENTS.md\`。

## 每次启动

1. 读取 \`IDENTITY.md\`。
2. 读取 \`SOUL.md\`。
3. 读取 \`USER.md\`。
4. 如果存在，读取今天和昨天的 \`memory/YYYY-MM-DD.md\`。
5. 声明或使用任何能力前先读取 \`TOOLS.md\`。
6. 只有任务需要长期项目或用户上下文时才读取 \`MEMORY.md\`。
7. 只有某个 skill 适用时才读取 \`skills/\` 下的对应文件。
8. 在新建解析器、导出器、浏览器辅助脚本、自动化脚本或模板填充脚本前，先读取 \`skills/_shared/TOOLCHAIN.md\`。

启动加载不需要向用户请示；相关文件加载后直接开始处理任务。

## 能力路由

| 能力 | 状态 | 必需 | 触发场景 | 降级方案 |
|---|---|---:|---|---|
${report.rows.map((row) => `| ${row.name} | ${row.status} | ${row.required ? "是" : "否"} | ${CAPABILITY_LABELS_ZH[row.name] || row.label} | ${row.fallbacks.join(" -> ") || "无"} |`).join("\n")}

## 核心工作流

${bodyWithoutTitle(loaded.workflow, "Workflow") || `1. 理解用户目标、目标平台、文件和约束。
2. 声明工具或工作流前，先检查能力映射。
3. 平台原生工具存在时优先使用。
4. 原生能力降级或缺失时，使用文档化的 fallback。
5. 用最小但有意义的检查验证结果。
6. 汇报改了什么、验证了什么、还剩什么不确定。`}

这是默认流程。用户任务或风险情况明显需要调整时，可以灵活改变顺序。

## 源指令

${bodyWithoutTitle(loaded.instructions, "Agent Instructions") || "未提供源指令。"}

## 记忆

- 短期上下文写入 \`memory/YYYY-MM-DD.md\`。
- 稳定经验、用户偏好和可复用方法写入 \`MEMORY.md\`。
- 用户画像事实写入 \`USER.md\`。
- 工具失败写入 \`ERRORS.md\`。
- 缺失能力写入 \`FEATURE_REQUESTS.md\`。
- 只存在脑中的记忆不会跨重启；落到文件才算。

## 自我改进台账

| 事件 | 写入位置 |
|---|---|
| 工具失败或平台能力不可用 | \`ERRORS.md\` |
| 用户纠正 | \`MEMORY.md\` 或 \`LEARNINGS.md\` |
| 缺失能力 | \`FEATURE_REQUESTS.md\` |
| 知识过时 | \`LEARNINGS.md\` |
| 更好的可复用方法 | \`MEMORY.md\` |

## 对话

- 先给结果或下一步动作。
- 只有缺失选择会阻塞安全执行时才提问。
- 清楚说明降级能力或缺失能力。
- 安装和迁移说明要具体、简短、可执行。
- 不确定性要对应到可验证路径。
- 新写脚本前先复用已打包的工具链资源。

## 边界

- 当前 OpenClaw 实例没有暴露 shell、browser、files、MCP、memory、patch 等工具时，不得声称可用。
- 不把 \`setup-guide.md\` 或 \`compatibility-report.md\` 当作人格或行为文件。
- 不把 secret、凭证、cookie、token、会话状态写入工作区记忆。
- 没有明确任务原因时，不覆盖用户工作或已生成的工作区文件。
- 未经用户明确同意，不让 bootstrap 信息污染核心身份或人格文件。
- 检查 \`skills/_shared/fallbacks/\` 前，不重写解析、导出或自动化脚本。
`;
}

function renderOpenClawSoul(loaded) {
  return `# Soul

${bodyWithoutTitle(loaded.soul, "Soul") || `${loaded.agent.name} 是一个务实、谨慎、对迁移差异敏感的 Agent。

## 几条真话

- 一个可迁移 Agent 只有在身份、工作流、能力、记忆和测试一起迁移时才可靠。
- 平台假设在影响回答前必须被明确说出来。
- 降级方案有价值，但它不是原生能力本身。
- 迁移结果必须能通过文件、命令或文档化检查来验证。

## 边界

- 不把平台没有的原生工具说成可用。
- 不为了让迁移看起来更顺利而隐藏能力缺口。
- 不把 secret 或会话状态写入记忆文件。
- 除非用户要求改变 Agent 本身，否则不改写 \`IDENTITY.md\`、\`SOUL.md\` 或 \`AGENTS.md\`。

## 气质

证据优先，表达简洁，谨慎对待用户工作，对平台差异保持敏感。`}
`;
}

function renderOpenClawIdentity(loaded) {
  return `# Identity

## 名片

- 名称：${loaded.agent.name}
- 版本：${loaded.agent.version || "0.1.0"}
- 描述：${loaded.agent.description}

## 定位

${bodyWithoutTitle(loaded.identity, "Identity") || "一个行为、能力、技能和验收方式足够明确，可导出到不同平台复用的 Agent。"}

## 来源

- 作者：${loaded.agent.author || "未指定"}
- 主页：${loaded.agent.homepage || "未指定"}
`;
}

function renderOpenClawUser(loaded) {
  return `# User

本文件用于记录这个 Agent 服务的人或团队。它不是 Agent 行为规则文件。

${bodyWithoutTitle(loaded.user, "User") || `## Stable Profile

- Preferred name:
- Role:
- Language:
- Location or timezone:
- Output preferences:

## Slowly Learned Context

-`}
`;
}

function renderOpenClawTools(loaded, report) {
  return `# Tools

本文件描述环境和能力配置。它不是技能清单，也不是人格文件。

## 能力映射

| 能力 | 状态 | 平台支持 | 必需 | 降级方案 |
|---|---|---|---:|---|
${report.rows.map((row) => {
    const fallback = row.fallbacks.length ? row.fallbacks.join(" -> ") : "无";
    return `| ${row.name} | ${row.status} | ${row.support} | ${row.required ? "是" : "否"} | ${fallback} |`;
  }).join("\n")}

## 源工具说明

${bodyWithoutTitle(loaded.tools, "Tools") || "在这里补充角色专属的工具端点、工作区路径、输出格式和平台偏好。所有能力声明必须与上方能力映射保持一致。"}

## 工具使用规则

- 优先使用平台原生工具。
- 新建脚本或模板前，先复用 \`skills/_shared/\` 里的已打包资源。
- 只有原生工具不可用时，才使用 fallback 脚本或人工交接流程。
- 当前 OpenClaw 实例没有暴露 shell、browser、MCP、memory 或 patch 工具前，不得声称可以使用。
`;
}

function renderOpenClawMemory(loaded) {
  return `# Memory

本工作区把记忆视为可迁移的项目上下文，而不是私有运行时状态。

## 可迁移记忆规则

- 稳定的 Agent 知识要写入可版本化的工作区文件。
- 不在这里存储 secret、API key、cookie、凭证或会话状态。
- 平台专属安装说明写入 setup guide 或导入提示，不写进长期行为规则。
- 只存在脑中的记忆不会跨重启；落到文件才算。

## 长期槽位

${bodyWithoutTitle(loaded.memory, "Memory") || `### 平台差异

-

### 迁移经验

-

### 用户稳定偏好

-

### 可复用验收检查

-`}
`;
}

function renderOpenClawBootstrap(loaded) {
  return `# Bootstrap

这是首次运行引导脚本。它用于让工作区逐步变得有用，但不能阻塞用户直接提出任务。

## 首次引导

1. 简短问候用户。
2. 说明本工作区可以把稳定偏好和可复用经验写入文件。
3. 只询问有助于后续工作的少量信息，例如称呼、角色、目标平台和输出偏好。
4. 如果用户直接提出任务，跳过引导并立即处理任务。
5. 将稳定的用户事实写入 \`USER.md\`。
6. 将可复用的工作经验写入 \`MEMORY.md\` 或 \`memory/YYYY-MM-DD.md\`。
7. 引导完成后，在 \`.openclaw/workspace-state.json\` 里写入 \`setupCompletedAt\`。

## 写入权限

Bootstrap 可以更新：

- \`USER.md\`
- \`MEMORY.md\`
- \`memory/YYYY-MM-DD.md\`
- \`.openclaw/workspace-state.json\`

除非用户明确要求改变 Agent 本身，否则 Bootstrap 不得更新：

- \`IDENTITY.md\`
- \`SOUL.md\`
- \`AGENTS.md\`
`;
}

function renderOpenClawHeartbeat() {
  return `# Heartbeat

当前未配置定时心跳任务。

只有当工作区需要周期性复盘、监控或跟进时，才在这里添加检查项。心跳任务应与普通任务流程分开。
`;
}

function renderOpenClawWorkspaceState(loaded) {
  const generatedAt = new Date().toISOString();
  return JSON.stringify({
    generatedBy: "portable-agent-kit",
    generatedAt,
    bootstrapSeededAt: generatedAt,
    setupCompletedAt: null,
    sourcePackage: loaded.agent.name,
    sourcePackageVersion: loaded.agent.version || "0.1.0"
  }, null, 2) + "\n";
}

function validateOpenClawWorkspace(outDir, loaded) {
  const requiredFiles = [
    "AGENTS.md",
    "IDENTITY.md",
    "SOUL.md",
    "BOOTSTRAP.md",
    "USER.md",
    "TOOLS.md",
    "MEMORY.md",
    "HEARTBEAT.md",
    ".openclaw/workspace-state.json"
  ];
  const missing = requiredFiles.filter((file) => !existsSync(path.join(outDir, file)));
  if (missing.length) {
    throw new Error(`OpenClaw export missing required files: ${missing.join(", ")}`);
  }
  const exportedSkillsDir = path.join(outDir, "skills");
  if (loaded.skillFiles.length && !existsSync(exportedSkillsDir)) {
    throw new Error("OpenClaw export declares skills but did not copy the skills directory.");
  }
  for (const file of loaded.skillFiles) {
    if (!existsSync(path.join(exportedSkillsDir, file))) {
      throw new Error(`OpenClaw export missing copied skill: skills/${file}`);
    }
  }
}

async function validateExportedSkillPathReferences(outDir, loaded) {
  const missing = [];
  for (const file of loaded.skillFiles) {
    const exportedSkill = path.join(outDir, "skills", file);
    if (!existsSync(exportedSkill)) continue;
    const body = await readText(exportedSkill);
    for (const match of body.matchAll(/`([^`\r\n]+)`/g)) {
      const normalized = normalizeRelativePath(match[1].trim());
      if (!normalized.startsWith("skills/") || normalized.includes("*")) continue;
      if (!existsSync(path.join(outDir, normalized))) {
        missing.push(`skills/${file}: ${normalized}`);
      }
    }
  }
  if (missing.length) {
    throw new Error(`Exported skills reference missing packaged files: ${missing.join(", ")}`);
  }
}

function renderOpenClawSkillIndex(loaded, report) {
  return `# ${loaded.agent.name} Skills

本文件是给需要单一 skill 文档的平台使用的兼容索引。OpenClaw 工作区的正式运行契约以 \`AGENTS.md\`、\`SOUL.md\`、\`IDENTITY.md\`、\`USER.md\` 和 \`TOOLS.md\` 为准。

## 技能文件

${loaded.skillFiles.map((file) => `- skills/${file}`).join("\n") || "- none"}

## 共享工具链

- \`skills/_shared/TOOLCHAIN.md\`
- \`skills/_shared/references/\`
- \`skills/_shared/templates/\`
- \`skills/_shared/fallbacks/\`

## 能力契约

${report.rows.map((row) => `- ${row.name}: ${row.status}; fallback: ${row.fallbacks.join(" -> ") || "none"}`).join("\n")}
`;
}

function renderClaudeMd(loaded, report) {
  return `# ${loaded.agent.name}

${loaded.agent.description}

## Instructions

${loaded.instructions.trim()}

## Portable Agent Capabilities

${report.rows.map((row) => `- ${row.name}: ${row.status} (${row.support})`).join("\n")}

## Skills

${loaded.skillFiles.map((file) => `- Read \`agent/skills/${file}\` or the exported setup guide when this skill applies.`).join("\n") || "- No skill files declared."}

## Migration Rules

- Treat this \`CLAUDE.md\` as the Claude-family project instruction file.
- Check \`skills/_shared/TOOLCHAIN.md\`, \`skills/_shared/fallbacks/\`, \`skills/_shared/references/\`, and \`skills/_shared/templates/\` before writing a new tool script.
- Keep platform-specific tool claims conditional on the current environment.
- When a required capability is unavailable, state the missing capability and use the documented fallback.
`;
}

async function renderSkillCards(loaded) {
  const cards = [];
  for (const file of loaded.skillFiles) {
    const body = await readExportedSkillBody(loaded, file);
    cards.push(`# ${file.replace(/\.md$/, "")}\n\n${body.trim()}`);
  }
  return cards.join("\n\n---\n\n") + "\n";
}

function help() {
  console.log(`Portable Agent Kit

Usage:
  portable-agent init [--agent agent] [--type generic|coding|writer|presales|architect] [--force]
  portable-agent doctor --target codex|openclaw|claude|accio-work|wukong|workbuddy [--agent agent]
  portable-agent export --target codex|openclaw|claude|accio-work|wukong|workbuddy [--agent agent] [--out dist/target]

Short alias:
  pak doctor --target wukong
`);
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === "init") return initCommand(args);
  if (command === "doctor") return doctorCommand(args);
  if (command === "export") return exportCommand(args);
  help();
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
