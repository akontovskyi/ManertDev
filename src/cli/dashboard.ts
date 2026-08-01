/**
 * Open the ManertDev frontend dashboard with scan root = where `manert` ran.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { c } from "../lib/cli-theme";

function packageRoot(): string {
  // src/cli → repo / global install root
  return path.resolve(__dirname, "../..");
}

function dashboardPort(): number {
  const raw =
    process.env.MANERT_DASHBOARD_PORT ||
    process.env.PORT ||
    "3000";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

function dashboardBaseUrl(port: number): string {
  return (
    process.env.MANERT_DASHBOARD_URL || `http://127.0.0.1:${port}`
  ).replace(/\/$/, "");
}

function probeUrl(url: string, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve((res.statusCode || 500) < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(
  url: string,
  timeoutMs = 90_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await probeUrl(url)) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

function openBrowser(url: string): void {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

function startNextDev(opts: {
  pkgRoot: string;
  port: number;
  scanRoot: string;
}): void {
  const nextBin = path.join(
    opts.pkgRoot,
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  if (!fs.existsSync(nextBin)) {
    throw new Error(
      `Next.js not found at ${nextBin}. From the ManertDev package run: npm install`,
    );
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MANERT_SCAN_ROOT: opts.scanRoot,
    PORT: String(opts.port),
  };
  // Ensure system CA for Windows TLS (Supabase / OpenRouter from Next)
  if (!String(env.NODE_OPTIONS || "").includes("--use-system-ca")) {
    env.NODE_OPTIONS = env.NODE_OPTIONS
      ? `${env.NODE_OPTIONS} --use-system-ca`
      : "--use-system-ca";
  }

  const child = spawn(
    process.execPath,
    ["--use-system-ca", nextBin, "dev", "-p", String(opts.port), "-H", "127.0.0.1"],
    {
      cwd: opts.pkgRoot,
      env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();
}

export async function openDashboard(opts?: {
  root?: string;
  port?: number;
}): Promise<void> {
  const scanRoot = path.resolve(
    opts?.root || process.env.MANERT_SCAN_ROOT || process.cwd(),
  );
  const port = opts?.port || dashboardPort();
  const base = dashboardBaseUrl(port);
  const healthUrl = `${base}/`;
  const dashUrl = `${base}/dashboard?root=${encodeURIComponent(scanRoot)}`;
  const pkgRoot = packageRoot();

  console.log("");
  console.log(c.smartBlue("ManertDev dashboard"));
  console.log(c.dim(`  scan root: ${scanRoot}`));
  console.log(c.dim(`  url:       ${dashUrl}`));

  let ready = await probeUrl(healthUrl);
  if (!ready) {
    console.log(c.dim(`  starting Next.js on port ${port} …`));
    try {
      startNextDev({ pkgRoot, port, scanRoot });
    } catch (err) {
      console.error(c.red(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
      return;
    }
    ready = await waitForServer(healthUrl);
    if (!ready) {
      console.error(
        c.red(
          `Dashboard server did not become ready on ${base}. Try: npm run dev`,
        ),
      );
      process.exitCode = 1;
      return;
    }
  } else {
    console.log(c.dim("  server already running"));
  }

  openBrowser(dashUrl);
  console.log(c.green("  opened in browser"));
  console.log(
    c.dim(
      "  Tip: chat/scans in the dashboard use this scan root (execution cwd).",
    ),
  );
  console.log("");
}
