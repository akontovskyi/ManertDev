/**
 * Modal cloud runner for ManertDev heavy scans + hosted model asks.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import fg from "fast-glob";

export type ModalFilePayload = { path: string; content: string };

export function getModalConfigStatus(): {
  configured: boolean;
  hasToml: boolean;
  hasEnvTokens: boolean;
  profile?: string;
  python: string;
} {
  const hasToml = fs.existsSync(path.join(os.homedir(), ".modal.toml"));
  const hasEnvTokens = Boolean(
    process.env.MODAL_TOKEN_ID && process.env.MODAL_TOKEN_SECRET,
  );
  return {
    configured: hasToml || hasEnvTokens,
    hasToml,
    hasEnvTokens,
    profile: process.env.MODAL_PROFILE,
    python: process.env.MANERT_PYTHON || "python",
  };
}

function packageRoot(): string {
  return path.resolve(__dirname, "../..");
}

function modalAppPath(): string {
  return path.join(packageRoot(), "modal_app", "manert.py");
}

export async function collectModalFiles(
  root: string,
  opts?: { maxFiles?: number; maxBytes?: number },
): Promise<ModalFilePayload[]> {
  const maxFiles = opts?.maxFiles ?? 60;
  const maxBytes = opts?.maxBytes ?? 60_000;
  const abs = path.resolve(root);

  const paths = await fg(
    [
      "**/*.{js,jsx,ts,tsx,mjs,cjs,py,go,rs,java}",
      "**/*.{env,json,yml,yaml,toml}",
      "**/Dockerfile*",
    ],
    {
      cwd: abs,
      absolute: true,
      onlyFiles: true,
      dot: true,
      ignore: [
        "**/node_modules/**",
        "**/.git/**",
        "**/.next/**",
        "**/dist/**",
        "**/build/**",
        "**/coverage/**",
        "**/modal_app/**",
      ],
      followSymbolicLinks: false,
    },
  );

  const files: ModalFilePayload[] = [];
  for (const p of paths.slice(0, maxFiles)) {
    try {
      const st = fs.statSync(p);
      if (!st.isFile() || st.size > 400_000) continue;
      let content = fs.readFileSync(p, "utf8");
      if (content.length > maxBytes) content = content.slice(0, maxBytes);
      files.push({
        path: path.relative(abs, p).replace(/\\/g, "/"),
        content,
      });
    } catch {
      // skip
    }
  }
  return files;
}

function extractJson(blob: string): unknown | null {
  const start = blob.lastIndexOf("MANERT_JSON_START");
  const end = blob.lastIndexOf("MANERT_JSON_END");
  if (start >= 0 && end > start) {
    const slice = blob
      .slice(start + "MANERT_JSON_START".length, end)
      .trim();
    try {
      return JSON.parse(slice);
    } catch {
      // fall through
    }
  }

  // Fallback: last JSON object in the stream
  const jsonStart = blob.lastIndexOf("{");
  if (jsonStart < 0) return null;
  const candidate = blob.slice(jsonStart).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // try to find a balanced object
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = jsonStart; i < blob.length; i++) {
      const ch = blob[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(blob.slice(jsonStart, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

function runModal(
  cliArgs: string[],
  opts?: { timeoutMs?: number },
): Promise<unknown> {
  const py = process.env.MANERT_PYTHON || "python";
  const env = {
    ...process.env,
    PYTHONUTF8: process.env.PYTHONUTF8 || "1",
    PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8",
  };

  return new Promise((resolve, reject) => {
    const child = spawn(py, ["-m", "modal", "run", modalAppPath(), ...cliArgs], {
      cwd: packageRoot(),
      env,
      windowsHide: true,
    });

    let combined = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Modal timed out after ${opts?.timeoutMs ?? 180_000}ms`));
    }, opts?.timeoutMs ?? 180_000);

    child.stdout.on("data", (d) => {
      combined += String(d);
    });
    child.stderr.on("data", (d) => {
      combined += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const parsed = extractJson(combined);
      if (parsed) {
        resolve(parsed);
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `Modal exit ${code}: ${combined.slice(-600) || "unknown error"}`,
          ),
        );
        return;
      }
      reject(
        new Error(`Modal returned no JSON. ${combined.slice(-400)}`),
      );
    });
  });
}

export async function probeModal(): Promise<{
  ok: boolean;
  message: string;
  details?: unknown;
}> {
  const status = getModalConfigStatus();
  if (!status.configured) {
    return {
      ok: false,
      message:
        "Modal not configured. Run: pip install modal && python -m modal setup",
    };
  }

  try {
    const out = await runModal(["--ping-only"], { timeoutMs: 180_000 });
    return {
      ok: true,
      message: "Modal connected (manertdev app)",
      details: out,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runModalHeavyScan(opts: {
  root: string;
  kind?: string;
  query?: string;
  narrate?: boolean;
}): Promise<unknown> {
  const files = await collectModalFiles(opts.root);
  const payload = {
    mode: "scan",
    root: opts.root,
    kind: opts.kind || "full",
    query: opts.query || "full scan",
    files,
    narrate: Boolean(opts.narrate),
    api_key:
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENROUTER_FALLBACK_API_KEY ||
      undefined,
    model: process.env.OPENROUTER_MODEL || "openrouter/free",
  };

  const jobPath = path.join(
    os.tmpdir(),
    `manert-modal-payload-${Date.now()}.json`,
  );
  fs.writeFileSync(jobPath, JSON.stringify(payload), "utf8");
  try {
    return await runModal([`--payload-file=${jobPath}`], {
      timeoutMs: 300_000,
    });
  } finally {
    try {
      fs.unlinkSync(jobPath);
    } catch {
      // ignore
    }
  }
}

export async function runModalAsk(opts: {
  prompt: string;
  model?: string;
}): Promise<unknown> {
  const payload = {
    mode: "ask",
    prompt: opts.prompt,
    model: opts.model || process.env.OPENROUTER_MODEL || "openrouter/free",
    api_key:
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENROUTER_FALLBACK_API_KEY ||
      undefined,
  };

  const jobPath = path.join(
    os.tmpdir(),
    `manert-modal-ask-${Date.now()}.json`,
  );
  fs.writeFileSync(jobPath, JSON.stringify(payload), "utf8");
  try {
    return await runModal([`--payload-file=${jobPath}`], {
      timeoutMs: 180_000,
    });
  } finally {
    try {
      fs.unlinkSync(jobPath);
    } catch {
      // ignore
    }
  }
}
