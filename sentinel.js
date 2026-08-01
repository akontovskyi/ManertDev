#!/usr/bin/env node
/**
 * SentinelDev global CLI entry point.
 * Install:  npm install -g .
 * Verify:   sentinel --help
 *           sentinel scan .
 */

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const cli = path.join(__dirname, "src", "cli", "index.ts");
const tsxCli = path.join(__dirname, "node_modules", "tsx", "dist", "cli.mjs");

const args = process.argv.slice(2);
const nodeArgs = ["--use-system-ca"];

let result;
if (require("node:fs").existsSync(tsxCli)) {
  result = spawnSync(
    process.execPath,
    [...nodeArgs, tsxCli, cli, ...args],
    { stdio: "inherit", env: process.env },
  );
} else {
  // Global install may hoist tsx — try npx
  result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--yes", "tsx", cli, ...args],
    { stdio: "inherit", env: process.env, shell: true },
  );
}

process.exit(result.status == null ? 1 : result.status);
