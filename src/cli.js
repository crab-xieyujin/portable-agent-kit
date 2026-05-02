#!/usr/bin/env node
import { mkdir, readFile, writeFile, readdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = ["codex", "openclaw", "accio-work", "wukong", "workbuddy"];

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
  if (value.startsWith("manual") || value.startsWith("upload") || value.includes("fallback")) return 0.5;
  if (value.includes("limited")) return 0.5;
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
    await writeText(path.join(outDir, "SKILL.md"), renderOpenClawSkill(loaded, report));
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

function renderOpenClawSkill(loaded, report) {
  return `# ${loaded.agent.name}

${loaded.agent.description}

## Instructions

${loaded.instructions.trim()}

## Capability Contract

${report.rows.map((row) => `- ${row.name}: ${row.status}; fallback: ${row.fallbacks.join(" -> ") || "none"}`).join("\n")}
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
  portable-agent doctor --target codex|openclaw|accio-work|wukong|workbuddy [--agent agent]
  portable-agent export --target codex|openclaw|accio-work|wukong|workbuddy [--agent agent] [--out dist/target]

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
