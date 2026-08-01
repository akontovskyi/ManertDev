/**
 * Env loading — secrets stay OUTSIDE the project workspace.
 *
 * Priority (later wins for overrides):
 *   1) project .env / .env.local  (non-secrets only — no API keys expected)
 *   2) ~/.sentineldev/.env        (REAL secrets — never in git)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Keys that must never be read from the project workspace if avoidable. */
const SECRET_KEYS = new Set([
  "OPENROUTER_API_KEY",
  "OPENROUTER_FALLBACK_API_KEY",
  "OPENROUTER_API_KEY_FALLBACK",
  "OPENAI_API_KEY",
  "OPENAI_FALLBACK_API_KEY",
  "NVIDIA_API_KEY",
  "NVAPI_KEY",
  "OSSPREY_API_KEY",
  "OSPREY_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "MODAL_TOKEN_ID",
  "MODAL_TOKEN_SECRET",
]);

export function userSecretsPath(): string {
  return path.join(os.homedir(), ".sentineldev", ".env");
}

function applyEnvFile(
  filePath: string,
  opts?: { allowSecrets?: boolean; overwrite?: boolean },
) {
  if (!fs.existsSync(filePath)) return;
  const allowSecrets = opts?.allowSecrets ?? true;
  const overwrite = opts?.overwrite ?? false;

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

    // Block secret keys coming from project workspace files
    if (!allowSecrets && SECRET_KEYS.has(key)) {
      continue;
    }

    if (overwrite || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function loadEnvFiles(packageRootHint?: string) {
  const homeSecrets = userSecretsPath();

  const projectFiles: string[] = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), ".env.local"),
  ];

  if (packageRootHint) {
    projectFiles.push(
      path.join(packageRootHint, ".env"),
      path.join(packageRootHint, ".env.local"),
    );
  }

  try {
    const fromCli = path.resolve(__dirname, "../..");
    projectFiles.push(
      path.join(fromCli, ".env"),
      path.join(fromCli, ".env.local"),
    );
  } catch {
    // ignore
  }

  // 1) Project files — ignore secret keys (keeps keys out of "virtual"/workspace env)
  for (const p of projectFiles) {
    applyEnvFile(p, { allowSecrets: false, overwrite: false });
  }

  // 2) User home secrets — authoritative for API keys
  applyEnvFile(homeSecrets, { allowSecrets: true, overwrite: true });
}

/**
 * Ensure ~/.sentineldev exists. Does NOT copy project .env.local anymore
 * (that would pull secrets back into a sync path from the workspace).
 */
export function ensureUserEnv(): string {
  const homeDir = path.join(os.homedir(), ".sentineldev");
  if (!fs.existsSync(homeDir)) fs.mkdirSync(homeDir, { recursive: true });
  const dest = userSecretsPath();
  if (!fs.existsSync(dest)) {
    fs.writeFileSync(
      dest,
      [
        "# SentinelDev secrets (outside project)",
        "# OPENROUTER_API_KEY=...              # primary (security keywords)",
        "# OPENROUTER_FALLBACK_API_KEY=...     # general chat + failure fallback",
        "# OSSPREY_API_KEY=ospy_...            # supply-chain malware scans",
        "# NEXT_PUBLIC_SUPABASE_URL=...",
        "# NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...",
        "",
      ].join("\n"),
      "utf8",
    );
  }
  return dest;
}

export function secretsConfigured(): boolean {
  loadEnvFiles();
  return Boolean(
    process.env.OPENROUTER_API_KEY ||
      process.env.OPENROUTER_FALLBACK_API_KEY ||
      process.env.OPENROUTER_API_KEY_FALLBACK ||
      process.env.OPENAI_API_KEY ||
      process.env.OPENAI_FALLBACK_API_KEY ||
      process.env.NVIDIA_API_KEY ||
      process.env.NVAPI_KEY,
  );
}
