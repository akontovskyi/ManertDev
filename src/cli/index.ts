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
 *   sentinel ossprey [path]
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
import {
  probeOssprey,
  getOsspreyConfigStatus,
} from "../lib/ossprey";
import {
  probeModal,
  getModalConfigStatus,
  runModalHeavyScan,
  runModalAsk,
} from "../lib/modal";
import type { Finding, ScanKind, SentinelReport } from "../lib/types";
import { editorLabel } from "../lib/editor";
import { loadEnvFiles, ensureUserEnv } from "../lib/env";
import { startRepl } from "./repl";
import { getNvidiaConfig } from "../lib/nvidia";
import {
  loadProjectContext,
  saveProjectContext,
} from "../lib/report";
import {
  listFixLogs,
  markFixLogFixed,
} from "../lib/supabase";

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
    "project",
    "logs",
    "mark-fixed",
    "ossprey",
    "osprey",
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
    } else if (a === "--ossprey" || a === "--osprey" || a === "--supply-chain") {
      kind = "ossprey";
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
  try {
    const rows = reportToFixLogs(report);
    const persist = await persistFixLogs(rows);
    if (persist.ok) {
      console.log(c.green(`  Supabase: stored ${persist.count} fix_log row(s).`));
    } else if (persist.error) {
      console.log(c.dim(`  Supabase (non-fatal): ${persist.error}`));
    }
  } catch (err) {
    console.log(
      c.dim(
        `  Supabase persist skipped: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }
}

async function main() {
  loadEnvFiles();
  ensureUserEnv();
  loadEnvFiles();

  const parsed = parseArgs(process.argv);
  if (parsed.plain) process.env.NO_COLOR = "1";

  const { cmd, root, kind, query, target, wantPatch } = parsed;

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(formatCliHelp());
    const cfg =
      getNvidiaConfig({ preferFallback: true }) || getNvidiaConfig();
    console.log(
      cfg
        ? c.dim(`  Live model ready: ${cfg.model} · auto-fallback on`)
        : c.yellow(
            "  Live model: set OPENROUTER_API_KEY and/or OPENROUTER_FALLBACK_API_KEY in ~/.sentineldev/.env",
          ),
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

  if (cmd === "project") {
    // sentinel project
    // sentinel project set --name X --details "..."
    const sub = target || parsed.positional[0] || "show";
    if (sub === "set" || parsed.positional.includes("set")) {
      let name = process.env.SENTINEL_PROJECT_NAME || "";
      let details = process.env.SENTINEL_PROJECT_DETAILS || "";
      const args = process.argv.slice(2);
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--name" && args[i + 1]) name = args[++i];
        if (
          (args[i] === "--details" || args[i] === "--detail") &&
          args[i + 1]
        ) {
          details = args[++i];
        }
      }
      if (!name) {
        console.error(c.red('Usage: sentinel project set --name "MyApp" --details "..."'));
        process.exitCode = 1;
        return;
      }
      const dest = saveProjectContext(root, {
        name,
        details: details || `${name} (managed by SentinelDev)`,
      });
      console.log(c.green(`Project saved → ${dest}`));
      console.log(c.dim(`name:    ${name}`));
      console.log(c.dim(`details: ${details || "(default)"}`));
      return;
    }
    const ctx = loadProjectContext(root);
    console.log("");
    console.log(c.smartBlue("Project context"));
    console.log(c.white(`  name:    ${ctx.name}`));
    console.log(c.dim(`  details: ${ctx.details}`));
    console.log(
      c.dim(
        '  set with: sentinel project set --name "MyApp" --details "what this app does"',
      ),
    );
    console.log("");
    return;
  }

  if (cmd === "logs") {
    const logs = await listFixLogs(30);
    console.log("");
    console.log(c.smartBlue("Fix logs (Supabase)"));
    if (!logs.length) {
      console.log(
        c.dim(
          "  No rows yet. Run a scan (sentinel scan .) after creating the table, or insert manually.",
        ),
      );
      console.log("");
      return;
    }
    for (const row of logs) {
      console.log(
        c.white(
          `[${row.severity}] ${row.timestamp}  fixed=${row.fixed ? "yes" : "no"}`,
        ),
      );
      console.log(c.dim(`  type:    ${row.problem_type}`));
      console.log(c.dim(`  project: ${row.project_name || "(none)"}`));
      console.log(c.dim(`  issue:   ${row.description.slice(0, 120)}`));
      console.log(
        c.dim(
          `  file:    ${row.file_path || "?"}${row.line_number ? `:${row.line_number}` : ""}`,
        ),
      );
      console.log(c.green(`  fix:     ${row.proposed_remediation.slice(0, 120)}`));
      if (row.id) console.log(c.muted(`  id:      ${row.id}`));
      console.log("");
    }
    return;
  }

  if (cmd === "mark-fixed") {
    const id =
      target ||
      positionalOrFail(parsed, "Usage: sentinel mark-fixed <fix-log-id>");
    const res = await markFixLogFixed(id);
    if (!res.ok) {
      console.error(c.red(res.error || "failed"));
      process.exitCode = 1;
      return;
    }
    console.log(c.green(`Marked fixed: ${res.count} row(s) for ${id}`));
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
    const nv =
      getNvidiaConfig({ preferFallback: true }) || getNvidiaConfig();
    console.log(
      c.dim(
        `  model:      ${nv ? `LIVE · ${nv.model} · fallbacks on` : "(no API key)"}`,
      ),
    );
    const osprey = getOsspreyConfigStatus();
    console.log(
      c.dim(
        `  ossprey:    ${osprey.configured ? `key set · ${osprey.baseUrl}` : "(no OSSPREY_API_KEY)"}`,
      ),
    );
    const modalCfg = getModalConfigStatus();
    console.log(
      c.dim(
        `  modal:      ${modalCfg.configured ? `ready · profile ${modalCfg.profile || "default"}` : "(run python -m modal setup)"}`,
      ),
    );
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
    const op = await probeOssprey();
    if (op.ok) {
      console.log(c.green(`OK  ${op.message}`));
    } else {
      console.log(c.yellow(`WARN  Ossprey: ${op.message}`));
    }
    const mp = await probeModal();
    if (mp.ok) {
      console.log(c.green(`OK  ${mp.message}`));
    } else {
      console.log(c.yellow(`WARN  Modal: ${mp.message}`));
    }
    console.log("");
    return;
  }

  if (cmd === "ossprey" || cmd === "osprey") {
    let scanRoot = root;
    const pos = parsed.positional[0];
    if (pos) {
      const maybePath = path.resolve(pos);
      if (pos === "." || fs.existsSync(maybePath)) {
        scanRoot = path.resolve(pos);
      }
    }
    console.log(c.dim(`Ossprey supply-chain scan → ${scanRoot}`));
    const report = await runScan({
      root: scanRoot,
      kind: "ossprey",
      query: query || "ossprey",
    });
    await printReport(report);
    return;
  }

  if (cmd === "modal") {
    // sentinel modal [--ask "..." | "deep scan"] [--narrate]
    const args = process.argv.slice(3);
    let askPrompt = "";
    let narrate = false;
    const rest: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--ask" && args[i + 1]) {
        askPrompt = args[++i];
      } else if (args[i] === "--narrate") {
        narrate = true;
      } else if (args[i] === "--ping") {
        const mp = await probeModal();
        console.log("");
        console.log(mp.ok ? c.green(mp.message) : c.red(mp.message));
        if (mp.details) console.log(c.dim(JSON.stringify(mp.details, null, 2)));
        console.log("");
        return;
      } else if (!args[i].startsWith("-")) {
        rest.push(args[i]);
      }
    }
    if (!askPrompt && rest[0] && /^(ask|chat)$/i.test(rest[0])) {
      askPrompt = rest.slice(1).join(" ");
      rest.length = 0;
    }

    if (askPrompt) {
      console.log(c.dim("Modal → live model ask"));
      try {
        const out = (await runModalAsk({ prompt: askPrompt })) as {
          content?: string;
          model?: string;
          ok?: boolean;
        };
        console.log("");
        console.log(c.smartBlue(`Live model (${out.model || "default"})`));
        console.log("");
        console.log(out.content || JSON.stringify(out, null, 2));
        console.log("");
      } catch (err) {
        console.error(
          c.red(err instanceof Error ? err.message : String(err)),
        );
        process.exitCode = 1;
      }
      return;
    }

    const scanQuery = query || rest.join(" ") || "full scan";

    const routed = routeQuery(scanQuery);
    console.log(
      c.dim(
        `Modal heavy scan (${routed.kind}) → ${root}${narrate ? " + live model narrate" : ""}`,
      ),
    );
    try {
      const out = (await runModalHeavyScan({
        root,
        kind: routed.kind,
        query: scanQuery,
        narrate,
      })) as {
        summary?: string;
        findings?: Finding[];
        narration?: string;
        fileCount?: number;
      };

      const report: SentinelReport = {
        summary: out.summary || "Modal heavy scan complete.",
        findings: out.findings || [],
        evidence: (out.findings || []).map((f) => f.evidence),
        proposedFixes: (out.findings || []).map(
          (f) => `[${f.severity}] ${f.title} → ${f.remediation}`,
        ),
        scanKind: routed.kind === "iam" ? "full" : routed.kind,
        targetPath: root,
        scannedAt: new Date().toISOString(),
      };
      await printReport(report);
      if (out.narration) {
        console.log(c.smartBlue("Live model narration"));
        console.log(out.narration);
        console.log("");
      }
      console.log(c.dim(`files sent: ${out.fileCount ?? "?"}`));
      console.log("");
    } catch (err) {
      console.error(c.red(err instanceof Error ? err.message : String(err)));
      console.log("");
      console.log(c.dim("Fallback: local task description"));
      console.log(
        buildModalTaskDescription({
          root,
          kind: routed.kind,
          query: scanQuery,
        }),
      );
      console.log("");
      process.exitCode = 1;
    }
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
