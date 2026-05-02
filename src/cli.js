#!/usr/bin/env node
import { mkdir, readFile, writeFile, readdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
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

function bodyWithoutTitle(markdown, title) {
  const trimmed = markdown.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\r?\n/);
  if (lines[0].trim().toLowerCase() === `# ${title}`.toLowerCase()) {
    return lines.slice(1).join("\n").trim();
  }
  return trimmed;
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
  return {
    agentDir,
    agent: await readJson(agentFile),
    capabilities: await readJson(capabilitiesFile),
    identity: await readOptionalText(path.join(agentDir, "identity.md")),
    soul: await readOptionalText(path.join(agentDir, "soul.md")),
    instructions: await readOptionalText(path.join(agentDir, "instructions.md")),
    workflow: await readOptionalText(path.join(agentDir, "workflow.md")),
    user: await readOptionalText(path.join(agentDir, "user.md")),
    tools: await readOptionalText(path.join(agentDir, "tools.md")),
    memory: await readOptionalText(path.join(agentDir, "memory.md")),
    skillFiles: await listMarkdown(path.join(agentDir, "skills"))
  };
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

async function resolveTarget(args, command) {
  if (args.target) return args.target;
  const agentHint = args.agent ? ` --agent ${args.agent}` : "";
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `Missing --target for ${command}. Choose one: ${TARGETS.join(", ")}.\n` +
      `Example: portable-agent ${command} --target openclaw${agentHint}`
    );
  }

  console.log(`Which platform should this agent be adapted for?\n`);
  console.log(renderTargetOptions());
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question("\nEnter a number or target name: ")).trim().toLowerCase();
    const numeric = Number(answer);
    const target = Number.isInteger(numeric) && numeric >= 1 && numeric <= TARGETS.length
      ? TARGETS[numeric - 1]
      : TARGETS.find((item) => item === answer);
    if (!target) {
      throw new Error(`Unknown target "${answer}". Supported: ${TARGETS.join(", ")}`);
    }
    return target;
  } finally {
    rl.close();
  }
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

  await writeText(path.join(outDir, "compatibility-report.md"), renderDoctor(loaded.agent, adapter, report) + "\n");
  if (existsSync(path.join(loaded.agentDir, "evals"))) {
    await cp(path.join(loaded.agentDir, "evals"), path.join(outDir, "evals"), { recursive: true });
  }
  console.log(`Exported ${target} package to ${outDir}`);
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
      const body = await readText(path.join(loaded.agentDir, "skills", file));
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
- When a required capability is unavailable, state the missing capability and use the documented fallback.
- Do not pretend a platform-native tool exists when it is not available in the current environment.
`;
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

  const sourceSkillsDir = path.join(loaded.agentDir, "skills");
  if (existsSync(sourceSkillsDir)) {
    await cp(sourceSkillsDir, path.join(outDir, "skills"), { recursive: true });
  }
  validateOpenClawWorkspace(outDir, loaded);
}

function renderOpenClawAgents(loaded, report) {
  return `# ${loaded.agent.name}

${loaded.agent.description}

## Runtime Environment

This is an OpenClaw workspace generated by Portable Agent Kit. Treat the core workspace files as the runtime contract and keep migration-only files out of the agent's identity.

Core runtime files:

- \`AGENTS.md\`: operating manual, startup order, routing, workflow, memory rules, and boundaries.
- \`IDENTITY.md\`: short external identity card.
- \`SOUL.md\`: stable judgment, truths, temperament, and boundaries.
- \`BOOTSTRAP.md\`: first-run onboarding script.
- \`USER.md\`: stable user profile and preferences.
- \`TOOLS.md\`: current tool and capability map.
- \`MEMORY.md\`: long-term memory structure.
- \`HEARTBEAT.md\`: optional scheduled task hook.
- \`.openclaw/workspace-state.json\`: machine-readable lifecycle state.

Migration support files:

- \`setup-guide.md\`: installation guide for humans.
- \`compatibility-report.md\`: portability audit output.
- \`SKILL.md\`: compatibility index for platforms that expect a single skill document.

## First Run

If \`.openclaw/workspace-state.json\` has no \`setupCompletedAt\` value:

1. Read \`BOOTSTRAP.md\`.
2. Run onboarding only as far as the user allows.
3. Write durable user facts to \`USER.md\`.
4. Write reusable operating learnings to \`MEMORY.md\` or \`memory/YYYY-MM-DD.md\`.
5. Set \`setupCompletedAt\` when onboarding is complete.

Do not rewrite \`IDENTITY.md\`, \`SOUL.md\`, or \`AGENTS.md\` during bootstrap unless the user explicitly asks to change the agent itself.

## Every Startup

1. Read \`IDENTITY.md\`.
2. Read \`SOUL.md\`.
3. Read \`USER.md\`.
4. Read today's and yesterday's \`memory/YYYY-MM-DD.md\` files if they exist.
5. Read \`TOOLS.md\` before claiming or using any capability.
6. Read \`MEMORY.md\` only when long-term project or user context is relevant.
7. Read a file under \`skills/\` only when that skill applies to the task.

Do not ask for permission to perform startup loading. Start working once the relevant files are loaded.

## Capability Routing

| Capability | Status | Required | Trigger | Fallback |
|---|---|---:|---|---|
${report.rows.map((row) => `| ${row.name} | ${row.status} | ${row.required ? "yes" : "no"} | ${row.label} | ${row.fallbacks.join(" -> ") || "none"} |`).join("\n")}

## Core Workflow

${bodyWithoutTitle(loaded.workflow, "Workflow") || `1. Understand the user's goal, target platform, files, and constraints.
2. Check the capability map before claiming a tool or workflow.
3. Use native OpenClaw tools when they exist.
4. Use the documented fallback when a native capability is degraded or missing.
5. Verify the result with the smallest meaningful check.
6. Report what changed, what was verified, and what remains uncertain.`}

This workflow is the default path. Adjust it when the user's task or risk profile clearly calls for a different order.

## Source Instructions

${bodyWithoutTitle(loaded.instructions, "Agent Instructions") || "No source instructions were provided."}

## Memory

- Short-lived context belongs in \`memory/YYYY-MM-DD.md\`.
- Durable lessons, user preferences, and reusable methods belong in \`MEMORY.md\`.
- User profile facts belong in \`USER.md\`.
- Tool failures belong in \`ERRORS.md\`.
- Missing capabilities belong in \`FEATURE_REQUESTS.md\`.
- Brain-only memory does not survive a restart; file-backed memory does.

## Self-Improvement Ledger

| Event | Write To |
|---|---|
| Tool failure or unavailable platform feature | \`ERRORS.md\` |
| User correction | \`MEMORY.md\` or \`LEARNINGS.md\` |
| Missing ability | \`FEATURE_REQUESTS.md\` |
| Outdated knowledge | \`LEARNINGS.md\` |
| Better reusable method | \`MEMORY.md\` |

## Dialogue

- Lead with the result or next action.
- Ask only when a missing choice blocks safe execution.
- State degraded or missing capabilities plainly.
- Keep setup and migration instructions concrete and minimal.
- Tie uncertainty to a verification path.

## Boundaries

- Do not claim access to shell, browser, files, MCP, memory, or patch tools unless the current OpenClaw instance exposes them.
- Do not treat \`setup-guide.md\` or \`compatibility-report.md\` as personality or behavior files.
- Do not write secrets, credentials, cookies, tokens, or session state into workspace memory.
- Do not overwrite user work or generated workspace files without a clear task reason.
- Do not let bootstrap information mutate core identity or soul files without explicit user approval.
`;
}

function renderOpenClawSoul(loaded) {
  return `# Soul

${bodyWithoutTitle(loaded.soul, "Soul") || `${loaded.agent.name} is practical, careful, and portability-aware.

## Truths

- A portable agent is only reliable when its identity, workflow, capabilities, memory, and tests travel together.
- Platform assumptions must be visible before they affect the answer.
- A degraded fallback is useful, but it is not the same as native capability.
- Migration output must be verifiable by files, commands, or documented checks.

## Boundaries

- Do not pretend a platform-native tool exists when it does not.
- Do not hide capability gaps to make a migration look cleaner.
- Do not store secrets or session state in memory files.
- Do not rewrite \`IDENTITY.md\`, \`SOUL.md\`, or \`AGENTS.md\` unless the user asks to change the agent itself.

## Temperament

Evidence-first, concise, careful with user work, and sensitive to platform differences.`}
`;
}

function renderOpenClawIdentity(loaded) {
  return `# Identity

## Card

- Name: ${loaded.agent.name}
- Version: ${loaded.agent.version || "0.1.0"}
- Description: ${loaded.agent.description}

## Positioning

${bodyWithoutTitle(loaded.identity, "Identity") || "A portable AI agent whose behavior, capabilities, skills, and evals are explicit enough to export across platforms."}

## Ownership

- Author: ${loaded.agent.author || "unspecified"}
- Homepage: ${loaded.agent.homepage || "unspecified"}
`;
}

function renderOpenClawUser(loaded) {
  return `# User

This file is for the person or team this agent serves. It is not an agent behavior file.

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

This file describes environment and capability configuration. It is not the agent's skill list and not its personality.

## Capability Map

| Capability | Status | Support | Required | Fallback |
|---|---|---|---:|---|
${report.rows.map((row) => {
    const fallback = row.fallbacks.length ? row.fallbacks.join(" -> ") : "none";
    return `| ${row.name} | ${row.status} | ${row.support} | ${row.required ? "yes" : "no"} | ${fallback} |`;
  }).join("\n")}

## Source Tool Notes

${bodyWithoutTitle(loaded.tools, "Tools") || "Add role-specific tool endpoints, workspace paths, output formats, and platform preferences here. Keep every claim aligned with the capability map above."}

## Tool Policy

- Use platform-native tools first.
- Use fallback scripts or manual handoff only when native tools are unavailable.
- Do not claim access to shell, browser, MCP, memory, or patch tools until the current OpenClaw instance exposes them.
`;
}

function renderOpenClawMemory(loaded) {
  return `# Memory

This workspace treats memory as portable project context, not private runtime state.

## Portable Memory Rules

- Keep durable agent knowledge in versioned workspace files.
- Do not store secrets, API keys, cookies, credentials, or session state here.
- Record platform-specific setup notes in setup guides or import hints, not in long-lived behavioral instructions.
- Brain-only memory does not survive a restart. File-backed memory does.

## Long-Term Slots

${bodyWithoutTitle(loaded.memory, "Memory") || `### Platform Differences

-

### Migration Learnings

-

### User Stable Preferences

-

### Reusable Validation Checks

-`}
`;
}

function renderOpenClawBootstrap(loaded) {
  return `# Bootstrap

This is the first-run onboarding script. It helps the workspace become useful without blocking direct work.

## Onboarding

1. Greet the user briefly.
2. Explain that the workspace can preserve stable preferences and reusable lessons in files.
3. Ask only for information that helps future work, such as preferred name, role, target platforms, and output preferences.
4. If the user asks a direct task instead, skip onboarding and handle the task.
5. Record stable user facts in \`USER.md\`.
6. Record reusable operating lessons in \`MEMORY.md\` or \`memory/YYYY-MM-DD.md\`.
7. Set \`setupCompletedAt\` in \`.openclaw/workspace-state.json\` when onboarding is done.

## Write Permissions

Bootstrap may update:

- \`USER.md\`
- \`MEMORY.md\`
- \`memory/YYYY-MM-DD.md\`
- \`.openclaw/workspace-state.json\`

Bootstrap must not update these files unless the user explicitly asks to change the agent itself:

- \`IDENTITY.md\`
- \`SOUL.md\`
- \`AGENTS.md\`
`;
}

function renderOpenClawHeartbeat() {
  return `# Heartbeat

No scheduled heartbeat tasks are configured.

Add checks here only when the workspace needs periodic review, monitoring, or follow-up. Keep heartbeat work separate from normal task flow.
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

function renderOpenClawSkillIndex(loaded, report) {
  return `# ${loaded.agent.name} Skills

This file is a compatibility index for platforms that expect a single skill document. The canonical OpenClaw workspace contract is represented by \`AGENTS.md\`, \`SOUL.md\`, \`IDENTITY.md\`, \`USER.md\`, and \`TOOLS.md\`.

## Skill Files

${loaded.skillFiles.map((file) => `- skills/${file}`).join("\n") || "- none"}

## Capability Contract

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
- Keep platform-specific tool claims conditional on the current environment.
- When a required capability is unavailable, state the missing capability and use the documented fallback.
`;
}

async function renderSkillCards(loaded) {
  const cards = [];
  for (const file of loaded.skillFiles) {
    const body = await readText(path.join(loaded.agentDir, "skills", file));
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
