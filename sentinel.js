#!/usr/bin/env node
/**
 * SentinelDev global CLI entry point.
 * Always relaunches Node with --use-system-ca (required on many Windows setups
 * for NVIDIA / Supabase TLS — otherwise OpenAI SDK throws "Connection error").
 *
 * Install:  npm install -g .
 * Run:      sentinel
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const cli = path.join(__dirname, "src", "cli", "index.ts");
const localTsx = path.join(__dirname, "node_modules", "tsx", "dist", "cli.mjs");
// Pin aliases (@/*) to this package — without this, tsx reads cwd's tsconfig
// and breaks when `sentinel` is run from another project.
const tsconfig = path.join(__dirname, "tsconfig.json");

function withSystemCa(env) {
  const next = { ...env };
  const flag = "--use-system-ca";
  const existing = next.NODE_OPTIONS || "";
  if (!existing.includes(flag)) {
    next.NODE_OPTIONS = existing ? `${existing} ${flag}` : flag;
  }
  return next;
}

const args = process.argv.slice(2);
const env = withSystemCa(process.env);
const nodeArgs = ["--use-system-ca"];
const tsxArgs = ["--tsconfig", tsconfig, cli, ...args];

// Prefer local tsx (now a runtime dependency)
let result;
if (fs.existsSync(localTsx)) {
  result = spawnSync(
    process.execPath,
    [...nodeArgs, localTsx, ...tsxArgs],
    { stdio: "inherit", env },
  );
} else {
  // Fallback: npx tsx, still with system CA via NODE_OPTIONS
  result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--yes", "tsx", ...tsxArgs],
    { stdio: "inherit", env, shell: true },
  );
}

process.exit(result.status == null ? 1 : result.status);
