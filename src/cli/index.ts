#!/usr/bin/env node
/**
 * SentinelDev — terminal-native Secure AI helper
 *
 *   sentinel                  → interactive AI chat (Claude-style)
 *   sentinel scan .
 *   sentinel scan --endpoints
 *   sentinel ask "find exposed endpoints"
 *   sentinel chat
 *   sentinel explain <file>
 *   sentinel fix <issue-id>
 *   sentinel diff <file>
 *   sentinel supabase
 *   sentinel install
 */

import fs from "node:fs";
import path from "node:path";
import { runScan, kindFromString } from "../scanners";
import {
  routeQuery,
  wantsPatch,
  buildModalTaskDescription,
} from "../lib/router";
import {
  formatCliHelp,
  formatCliReport,
  formatInstallSteps,
  formatLocation,
  c,
} from "../lib/cli-theme";
import { reportToFixLogs } from "../lib/report";
import {
  persistFixLogs,
  probeSupabase,
  getSupabaseConfigStatus,
} from "../lib/supabase";
import type { Finding, ScanKind, SentinelReport } from "../lib/types";
import { editorLabel } from "../lib/editor";
import { loadEnvFiles, ensureUserEnv } from "../lib/env";
import { startRepl } from "./repl";
import { getNvidiaConfig } from "../lib/nvidia";

interface ParsedArgs {
  cmd: string;
  root: string;
  kind: ScanKind;
  query: string;
  target: string;
  plain: boolean;
  wantPatch: boolean;
  positional: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let cmd = args[0] || "chat";
  let root = process.env.SENTINEL_SCAN_ROOT || process.cwd();
  let kind: ScanKind = "full";
  let query = "";
  let target = "";
  let plain = false;
  let wantPatch = false;
  const positional: string[] = [];

  const known = new Set([
    "help",
    "--help",
    "-h",
    "scan",
    "ask",
    "chat",
    "repl",
    "explain",
    "fix",
    "diff",
    "modal",
    "supabase",
    "install",
    "status",
  ]);

  let startIdx = 1;
  if (!known.has(cmd) && !String(cmd).startsWith("-")) {
    query = args.join(" ");
    cmd = "ask";
    startIdx = args.length;
  }

  for (let i = startIdx; i < args.length; i++) {
    const a = args[i];
    if (a === "--root" && args[i + 1]) {
      root = path.resolve(args[++i]);
    } else if (a === "--kind" && args[i + 1]) {
      kind = kindFromString(args[++i]);
    } else if (a === "--endpoints" || a === "--endpoint") {
      kind = "endpoints";
    } else if (a === "--env" || a === "--secrets" || a === "--keys") {
      kind = "secrets";
    } else if (a === "--db" || a === "--database") {
      kind = "database";
    } else if (a === "--admin" || a === "--debug" || a === "--entrances") {
      kind = "entrances";
    } else if (a === "--scramble" || a === "--rotate") {
      kind = "scramble";
    } else if (a === "--full") {
      kind = "full";
    } else if (a === "--plain" || a === "--no-color") {
      plain = true;
    } else if (a === "--patch" || a === "--fix") {
      wantPatch = true;
    } else if (!a.startsWith("--")) {
      positional.push(a);
    }
  }

  if (cmd === "scan" && positional[0]) {
    const maybePath = path.resolve(positional[0]);
    if (positional[0] === "." || fs.existsSync(maybePath)) {
      root = path.resolve(positional[0]);
    } else {
      query = positional.join(" ");
    }
  } else if (cmd === "ask") {
    query = query || positional.join(" ");
  } else if (positional.length) {
    target = positional[0];
    if (!query) query = positional.slice(1).join(" ");
  }

  query = query.replace(/^["']|["']$/g, "");
  if (wantPatch && query && !wantsPatch(query)) query = `${query} apply fix`;
  if (wantPatch && !query) query = "apply fix";

  return { cmd, root, kind, query, target, plain, wantPatch, positional };
}

async function printReport(report: SentinelReport) {
  console.log(formatCliReport(report));
  const rows = reportToFixLogs(report);
  const persist = await persistFixLogs(rows);
  if (persist.ok) {
    console.log(c.green(`  Supabase: stored ${persist.count} fix_log row(s).`));
  } else if (persist.error) {
    console.log(c.dim(`  Supabase: ${persist.error}`));
  }
}

async function main() {
  loadEnvFiles();

  try {
    const localEnv = path.resolve(__dirname, "../../.env.local");
    if (fs.existsSync(localEnv)) {
      ensureUserEnv(fs.readFileSync(localEnv, "utf8"));
      loadEnvFiles();
    }
  } catch {
    // ignore
  }

  const parsed = parseArgs(process.argv);
  if (parsed.plain) process.env.NO_COLOR = "1";

  const { cmd, root, kind, query, target, wantPatch } = parsed;

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(formatCliHelp());
    const cfg = getNvidiaConfig();
    console.log(
      cfg
        ? c.dim(`  AI model ready: ${cfg.model}`)
        : c.yellow("  AI model: set NVIDIA_API_KEY to enable chat"),
    );
    console.log(
      c.violet('  Tip: run "sentinel" with no args to open interactive chat'),
    );
    console.log("");
    return;
  }

  if (cmd === "chat" || cmd === "repl") {
    await startRepl({ root });
    return;
  }

  if (cmd === "install") {
    console.log(formatInstallSteps(path.resolve(__dirname, "../..")));
    return;
  }

  if (cmd === "supabase" || cmd === "status") {
    const status = getSupabaseConfigStatus();
    console.log("");
    console.log(bannerStatus());
    console.log(c.white("Supabase connection"));
    console.log(c.dim(`  configured: ${status.configured}`));
    console.log(c.dim(`  url:        ${status.url || "(missing)"}`));
    console.log(c.dim(`  project:    ${status.projectRef || "(unknown)"}`));
    console.log(c.dim(`  key type:   ${status.keyType || "(none)"}`));
    console.log(c.dim(`  editor:     ${editorLabel()}`));
    const nv = getNvidiaConfig();
    console.log(c.dim(`  nvidia:     ${nv ? nv.model : "(no API key)"}`));
    const probe = await probeSupabase();
    console.log("");
    if (probe.ok) {
      console.log(c.green(`OK  ${probe.message}`));
    } else {
      console.log(c.red(`FAIL  ${probe.message}`));
      if (probe.details) {
        console.log(c.dim(JSON.stringify(probe.details, null, 2)));
      }
    }
    console.log("");
    return;
  }

  if (cmd === "modal") {
    const routed = routeQuery(query || "full scan");
    const task = buildModalTaskDescription({
      root,
      kind: routed.kind,
      query: query || routed.label,
    });
    console.log("");
    console.log(c.smartBlue("Modal task description (copy / POST)"));
    console.log("");
    console.log(task);
    console.log("");
    return;
  }

  if (cmd === "explain") {
    const file =
      target || positionalOrFail(parsed, "Usage: sentinel explain <file>");
    const abs = path.resolve(root, file);
    if (!fs.existsSync(abs)) {
      console.error(c.red(`File not found: ${abs}`));
      process.exitCode = 1;
      return;
    }
    const report = await runScan({
      root: path.dirname(abs),
      kind: "full",
      query: wantPatch ? "apply fix" : "explain",
    });
    const rel = path.basename(abs);
    const filtered: Finding[] = report.findings.filter(
      (f) =>
        f.evidence.file === rel ||
        f.evidence.file.endsWith(rel) ||
        path.resolve(report.targetPath, f.evidence.file) === abs,
    );
    const narrowed: SentinelReport = {
      ...report,
      summary: `Explain ${rel}: ${filtered.length} finding(s). Editor: ${editorLabel()}.`,
      findings: filtered,
      evidence: filtered.map((f) => f.evidence),
      proposedFixes: filtered.map(
        (f) => `[${f.severity}] ${f.title} → ${f.remediation}`,
      ),
      scanKind: "full",
      targetPath: path.dirname(abs),
    };
    if (filtered.length === 0) {
      console.log("");
      console.log(
        c.dim(`No findings matched ${rel}. Showing location for reference:`),
      );
      const loc = formatLocation(path.dirname(abs), abs, 1);
      console.log(`   ${loc.jumpBlock}`);
      console.log("");
    }
    await printReport(narrowed);
    return;
  }

  if (cmd === "fix") {
    const issueId =
      target || positionalOrFail(parsed, "Usage: sentinel fix <issue-id>");
    const report = await runScan({
      root,
      kind: "full",
      query: "apply fix",
    });
    const hit = report.findings.find(
      (f) => f.id === issueId || f.id.includes(issueId),
    );
    if (!hit) {
      console.error(c.red(`No finding matched issue-id: ${issueId}`));
      console.error(
        c.dim("Run: sentinel scan .   then copy an Issue ID from Findings."),
      );
      process.exitCode = 1;
      return;
    }
    const loc = formatLocation(
      root,
      hit.evidence.file,
      hit.evidence.line,
      hit.evidence.endLine,
      c.redSoft,
    );
    console.log("");
    console.log(c.smartBlue(`Proposed fix for ${hit.id} (NOT applied)`));
    console.log("");
    console.log(c.red(`[${hit.severity}] ${hit.title}`));
    console.log(c.dim(hit.description));
    console.log(`   ${loc.jumpBlock}`);
    console.log("");
    console.log(c.greenBold("Remediation"));
    console.log(c.green(`  ${hit.remediation}`));
    console.log("");
    console.log(c.violet("Patch (review before apply)"));
    console.log(
      hit.proposedPatch
        ? hit.proposedPatch
            .split("\n")
            .map((l) => c.violet(`  ${l}`))
            .join("\n")
        : c.dim("  No auto hunk available — follow remediation manually."),
    );
    console.log("");
    await persistFixLogs(reportToFixLogs({ ...report, findings: [hit] }));
    return;
  }

  if (cmd === "diff") {
    const file =
      target || positionalOrFail(parsed, "Usage: sentinel diff <file>");
    const abs = path.resolve(root, file);
    const report = await runScan({
      root: fs.existsSync(abs) ? path.dirname(abs) : root,
      kind: "full",
      query: "apply fix",
    });
    const rel = path.basename(abs);
    const hits = report.findings.filter(
      (f) =>
        (f.evidence.file === rel || f.evidence.file.endsWith(rel)) &&
        f.proposedPatch,
    );
    console.log("");
    console.log(c.smartBlue(`Proposed diffs for ${rel} (NOT applied)`));
    console.log("");
    if (hits.length === 0) {
      console.log(c.dim("  No proposed patches for this file."));
      console.log("");
      return;
    }
    for (const h of hits) {
      const loc = formatLocation(
        report.targetPath,
        h.evidence.file,
        h.evidence.line,
        h.evidence.endLine,
      );
      console.log(c.red(`[${h.severity}] ${h.title}  (${h.id})`));
      console.log(`   ${loc.jumpBlock}`);
      console.log(
        (h.proposedPatch || "")
          .split("\n")
          .map((l) => c.violet(`  ${l}`))
          .join("\n"),
      );
      console.log("");
    }
    return;
  }

  if (cmd === "scan" || cmd === "ask") {
    const routed =
      cmd === "ask" ? routeQuery(query || "full") : { kind, label: kind };
    const effectiveQuery =
      cmd === "ask"
        ? query || routed.label
        : wantPatch || wantsPatch(query)
          ? query || "apply fix"
          : query || routed.kind;

    const report = await runScan({
      root,
      kind: routed.kind,
      query: effectiveQuery,
    });
    await printReport(report);
    return;
  }

  console.log(formatCliHelp());
  process.exitCode = 1;
}

function positionalOrFail(parsed: ParsedArgs, usage: string): string {
  if (parsed.target) return parsed.target;
  if (parsed.positional[0]) return parsed.positional[0];
  console.error(c.red(usage));
  process.exit(1);
}

function bannerStatus(): string {
  return (
    c.smartBlue("╭──────────────────────────────────────────╮") +
    "\n" +
    c.smartBlue("│ * SentinelDev status                     │") +
    "\n" +
    c.smartBlue("╰──────────────────────────────────────────╯") +
    "\n"
  );
}

main().catch((err) => {
  console.error(c.red("SentinelDev error:"), err);
  process.exitCode = 1;
});
