/**
 * Load env from cwd, package root, and ~/.sentineldev/.env
 * so `sentinel` works globally with AI keys.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function applyEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

export function loadEnvFiles(packageRootHint?: string) {
  const homeDir = path.join(os.homedir(), ".sentineldev");
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.join(homeDir, ".env"),
    path.join(homeDir, "env"),
  ];

  if (packageRootHint) {
    candidates.push(
      path.join(packageRootHint, ".env.local"),
      path.join(packageRootHint, ".env"),
    );
  }

  // When running from src/cli, package root is ../..
  try {
    const fromCli = path.resolve(__dirname, "../..");
    candidates.push(path.join(fromCli, ".env.local"), path.join(fromCli, ".env"));
  } catch {
    // ignore
  }

  for (const p of candidates) applyEnvFile(p);
}

/** Ensure ~/.sentineldev/.env exists (copy keys for global CLI). */
export function ensureUserEnv(contents?: string) {
  const homeDir = path.join(os.homedir(), ".sentineldev");
  if (!fs.existsSync(homeDir)) fs.mkdirSync(homeDir, { recursive: true });
  const dest = path.join(homeDir, ".env");
  if (contents && !fs.existsSync(dest)) {
    fs.writeFileSync(dest, contents, "utf8");
    return dest;
  }
  return dest;
}
