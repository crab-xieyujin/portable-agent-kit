#!/usr/bin/env node
import { mkdir, readFile, writeFile, readdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = ["codex", "openclaw", "claude", "accio-work", "wukong", "workbuddy"];

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

async function writeText(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

async function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return names.filter((name) => name.endsWith(".md")).sort();
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
    instructions: existsSync(path.join(agentDir, "instructions.md"))
      ? await readText(path.join(agentDir, "instructions.md"))
      : "",
    skillFiles: await listMarkdown(path.join(agentDir, "skills"))
  };
}

async function loadAdapter(target) {
  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown target "${target}". Supported: ${TARGETS.join(", ")}`);
  }
  return readJson(path.join(KIT_ROOT, "adapters", target, "adapter.json"));
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
  if (existsSync(targetDir) && !args.force) {
    throw new Error(`${targetDir} already exists. Use --force to overwrite the sample agent folder.`);
  }
  if (existsSync(targetDir) && args.force) {
    await rm(targetDir, { recursive: true, force: true });
  }
  await cp(path.join(KIT_ROOT, "templates", "agent"), targetDir, { recursive: true });
  console.log(`Created portable agent package at ${targetDir}`);
  console.log(`Next: portable-agent doctor --target codex --agent ${path.relative(ROOT, targetDir)}`);
}

async function doctorCommand(args) {
  const target = args.target || "codex";
  const loaded = await loadAgent(resolveAgentDir(args));
  const adapter = await loadAdapter(target);
  const report = analyzeCompatibility(loaded.capabilities, adapter);
  console.log(renderDoctor(loaded.agent, adapter, report));
}

async function exportCommand(args) {
  const target = args.target || "codex";
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
  await writeText(path.join(outDir, "TOOLS.md"), renderOpenClawTools(report));
  await writeText(path.join(outDir, "MEMORY.md"), renderOpenClawMemory(loaded));
  await writeText(path.join(outDir, "BOOTSTRAP.md"), renderOpenClawBootstrap(loaded));
  await writeText(path.join(outDir, "SKILL.md"), renderOpenClawSkillIndex(loaded, report));

  const sourceSkillsDir = path.join(loaded.agentDir, "skills");
  if (existsSync(sourceSkillsDir)) {
    await cp(sourceSkillsDir, path.join(outDir, "skills"), { recursive: true });
  }
}

function renderOpenClawAgents(loaded, report) {
  return `# ${loaded.agent.name}

${loaded.agent.description}

## Agent Instructions

${loaded.instructions.trim()}

## Capability Contract

${report.rows.map((row) => `- ${row.name}: ${row.status}; fallback: ${row.fallbacks.join(" -> ") || "none"}`).join("\n")}

## Workspace Files

- \`AGENTS.md\`: agent operating contract and routing summary.
- \`SOUL.md\`: voice, judgment, and behavioral posture.
- \`IDENTITY.md\`: stable agent identity and scope.
- \`USER.md\`: user interaction assumptions and handoff rules.
- \`TOOLS.md\`: tool and capability mapping.
- \`MEMORY.md\`: portable memory conventions.
- \`skills/\`: source-backed skill bodies copied from the portable package.
`;
}

function renderOpenClawSoul(loaded) {
  return `# Soul

${loaded.agent.name} is practical, careful, and portability-aware.

## Behavioral Posture

- Complete the user's task with explicit evidence and honest uncertainty.
- Prefer native OpenClaw tools when they are available.
- Make hidden platform assumptions visible before relying on them.
- Preserve existing user work and avoid destructive changes unless explicitly requested.
- Keep explanations compact, but include verification when setup, migration, or implementation is involved.
`;
}

function renderOpenClawIdentity(loaded) {
  return `# Identity

Name: ${loaded.agent.name}
Version: ${loaded.agent.version || "0.1.0"}
Description: ${loaded.agent.description}

## Scope

This workspace is generated from a Portable Agent Kit package. The portable source of truth is the agent manifest, instructions, capabilities, skills, and evals that produced this OpenClaw workspace.

## Ownership

Author: ${loaded.agent.author || "unspecified"}
Homepage: ${loaded.agent.homepage || "unspecified"}
`;
}

function renderOpenClawUser(loaded) {
  return `# User

## Interaction Rules

- Lead with the result.
- Ask only when a missing choice blocks safe execution.
- If a platform capability is missing, name it and use the documented fallback.
- If migration output requires manual setup, give the user the smallest concrete next step.

## Source Instructions

${loaded.instructions.trim()}
`;
}

function renderOpenClawTools(report) {
  return `# Tools

## Capability Map

${report.rows.map((row) => {
    const fallback = row.fallbacks.length ? row.fallbacks.join(" -> ") : "none";
    return `- ${row.name}: ${row.status} (${row.support}); required=${row.required}; fallback=${fallback}`;
  }).join("\n")}

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

## Agent

- Name: ${loaded.agent.name}
- Package version: ${loaded.agent.version || "0.1.0"}
`;
}

function renderOpenClawBootstrap(loaded) {
  return `# Bootstrap

Read these files before operating:

1. \`IDENTITY.md\`
2. \`SOUL.md\`
3. \`AGENTS.md\`
4. \`TOOLS.md\`
5. \`USER.md\`
6. Relevant files in \`skills/\`

Use \`setup-guide.md\` and \`compatibility-report.md\` when installing, auditing, or moving this workspace.
`;
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
  portable-agent init [--agent agent] [--force]
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
