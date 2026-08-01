/**
 * Terminal-native CLI theme for SentinelDev.
 * Plain-text friendly, ANSI colors only — no web/markdown UI.
 */

import path from "node:path";
import type { Finding, FixLogRow, SentinelReport, Severity } from "./types";
import { reportToFixLogs } from "./report";
import { detectEditor, editorLabel, editorScheme } from "./editor";

const ESC = "\u001b[";
const OSC = "\u001b]";
const BEL = "\u0007";

const enabled =
  process.env.NO_COLOR == null &&
  process.stdout.isTTY !== false &&
  process.env.FORCE_COLOR !== "0";

function wrap(codes: string, text: string): string {
  if (!enabled) return text;
  return `${ESC}${codes}m${text}${ESC}0m`;
}

export const c = {
  peach: (t: string) => wrap("38;2;232;168;124", t),
  smartBlue: (t: string) => wrap("38;2;76;113;168", t),
  bold: (t: string) => wrap("1", t),
  white: (t: string) => wrap("97", t),
  dim: (t: string) => wrap("38;2;160;160;160", t),
  muted: (t: string) => wrap("38;2;110;110;110", t),
  red: (t: string) => wrap("38;2;232;88;88;1", t),
  redSoft: (t: string) => wrap("38;2;200;110;110", t),
  green: (t: string) => wrap("38;2;92;200;140", t),
  greenBold: (t: string) => wrap("38;2;92;200;140;1", t),
  violet: (t: string) => wrap("38;2;176;148;232", t),
  blue: (t: string) => wrap("38;2;110;168;232;4", t),
  yellow: (t: string) => wrap("38;2;220;180;90", t),
};

function banner(text: string): string {
  const inner = ` * ${text} `;
  const width = Math.max(inner.length + 2, 42);
  const pad = "─".repeat(width);
  return [
    c.smartBlue(`╭${pad}╮`),
    c.smartBlue(`│${inner.padEnd(width)}│`),
    c.smartBlue(`╰${pad}╯`),
  ].join("\n");
}

export function bannerPublic(text: string): string {
  return banner(text);
}

function asciiLogo(): string {
  const sentinel = [
    "███████╗███████╗███╗   ██╗████████╗██╗███╗   ██╗███████╗██╗     ",
    "██╔════╝██╔════╝████╗  ██║╚══██╔══╝██║████╗  ██║██╔════╝██║     ",
    "███████╗█████╗  ██╔██╗ ██║   ██║   ██║██╔██╗ ██║█████╗  ██║     ",
    "╚════██║██╔══╝  ██║╚██╗██║   ██║   ██║██║╚██╗██║██╔══╝  ██║     ",
    "███████║███████╗██║ ╚████║   ██║   ██║██║ ╚████║███████╗███████╗",
    "╚══════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝",
  ].map((l) => c.smartBlue(l));

  const indent = "                    ";
  const dev = [
    "",
    `${indent}██████╗ ███████╗██╗   ██╗`,
    `${indent}██╔══██╗██╔════╝██║   ██║`,
    `${indent}██║  ██║█████╗  ██║   ██║`,
    `${indent}██║  ██║██╔══╝  ╚██╗ ██╔╝`,
    `${indent}██████╔╝███████╗ ╚████╔╝ `,
    `${indent}╚═════╝ ╚══════╝  ╚═══╝  `,
  ].map((l) => c.smartBlue(l));

  return [...sentinel, ...dev].join("\n");
}

export function asciiLogoPublic(): string {
  return asciiLogo();
}

function resolveAbsPath(root: string, relOrAbs: string): string {
  if (path.isAbsolute(relOrAbs)) return path.normalize(relOrAbs);
  return path.normalize(path.resolve(root, relOrAbs));
}

function toEditorUri(absPath: string, line?: number, column = 1): string {
  const scheme = editorScheme();
  const normalized = absPath.replace(/\\/g, "/");
  const withDrive =
    /^[A-Za-z]:/.test(normalized) && !normalized.startsWith("/")
      ? `/${normalized}`
      : normalized;
  const lineNo = line && line > 0 ? line : 1;
  return `${scheme}://file${withDrive}:${lineNo}:${column}`;
}

function hyperlink(uri: string, label: string): string {
  if (!enabled) return label;
  return `${OSC}8;;${uri}${BEL}${label}${OSC}8;;${BEL}`;
}

export interface LocationInfo {
  basename: string;
  relative: string;
  absolute: string;
  line: number;
  column: number;
  endLine?: number;
  short: string;
  clickable: string;
  jumpBlock: string;
}

export function formatLocation(
  root: string,
  file: string,
  line?: number,
  endLine?: number,
  paint: (s: string) => string = (s) => s,
): LocationInfo {
  const abs = resolveAbsPath(root, file);
  const lineNo = line && line > 0 ? line : 1;
  const column = 1;
  const basename = path.basename(file);
  const relative = path.isAbsolute(file)
    ? path.relative(root, file) || file
    : file;
  const range =
    endLine && endLine > lineNo ? `L${lineNo}-L${endLine}` : `L${lineNo}`;
  const short = `${basename}:${lineNo}`;
  const uri = toEditorUri(abs, lineNo, column);
  // Terminal path detector form (opens in whichever IDE hosts the terminal)
  const detector = `${abs}:${lineNo}:${column}`;

  const clickable = paint(hyperlink(uri, short));
  const ide = editorLabel();
  const jumpBlock = [
    `${c.dim("File:")}     ${paint(hyperlink(uri, relative))}`,
    `${c.dim("Line:")}     ${paint(String(lineNo))}${endLine && endLine > lineNo ? c.dim(`  (through ${endLine})`) : ""}`,
    `${c.dim("Column:")}   ${paint(String(column))}`,
    `${c.dim("Range:")}    ${paint(range)}`,
    `${c.dim("Path:")}     ${paint(hyperlink(uri, abs))}`,
    `${c.dim("Jump:")}     ${paint(hyperlink(uri, detector))}  ${c.muted(`Ctrl+click → ${ide}`)}`,
  ].join("\n   ");

  return {
    basename,
    relative,
    absolute: abs,
    line: lineNo,
    column,
    endLine,
    short,
    clickable,
    jumpBlock,
  };
}

function severityColor(sev: Severity, text: string): string {
  switch (sev) {
    case "Critical":
    case "High":
      return c.red(text);
    case "Medium":
      return c.yellow(text);
    case "Low":
      return c.blue(text);
    default:
      return c.dim(text);
  }
}

function sectionHeader(title: string): string {
  return `\n${c.bold(c.white(title))}\n`;
}

function numberedItem(
  n: number,
  title: string,
  detail: string,
  titlePaint: (s: string) => string = (s) => c.bold(c.white(s)),
): string {
  const head = titlePaint(`${n}. ${title}`);
  const body = detail
    .split("\n")
    .map((line) => `   ${c.dim(line)}`)
    .join("\n");
  return `${head}\n${body}`;
}

function formatFinding(f: Finding, index: number, root: string): string {
  const loc = formatLocation(
    root,
    f.evidence.file,
    f.evidence.line,
    f.evidence.endLine,
    c.redSoft,
  );
  const title = `[${f.severity}] ${f.title}`;
  const head = severityColor(f.severity, `${index}. ${title}`);
  const idLine = `${c.dim("Issue ID:")} ${c.white(f.id)}`;
  const lines = [
    `   ${c.dim(f.description)}`,
    `   ${idLine}`,
    `   ${loc.jumpBlock}`,
    `   ${c.dim("Fix:")}      ${c.dim(f.remediation)}`,
  ];
  return `${head}\n${lines.join("\n")}`;
}

function formatEvidenceBlock(
  f: Finding,
  index: number,
  root: string,
): string {
  const loc = formatLocation(
    root,
    f.evidence.file,
    f.evidence.line,
    f.evidence.endLine,
    c.red,
  );
  const head = c.red(`${index}. `) + loc.clickable + c.dim(`  (${f.id})`);
  const meta = `   ${loc.jumpBlock}`;
  const code = f.evidence.snippet
    .split("\n")
    .map((line, i) => {
      // snippetAround uses radius 1 → first displayed line is max(1, line-1)
      const start = Math.max(1, (f.evidence.line || 1) - 1);
      const n = start + i;
      return c.redSoft(`   │ ${String(n).padStart(4, " ")} │ ${line}`);
    })
    .join("\n");
  return `${head}\n${meta}\n${code}`;
}

/** Supabase-style plain log block (also used for terminal clarity). */
export function formatFixLogPlain(rows: FixLogRow[]): string {
  if (rows.length === 0) return c.dim("   (no fix-log rows)");
  return rows
    .map((r) => {
      const block = [
        `[${r.severity}] ${r.timestamp}`,
        `Issue: ${r.description}`,
        `File: ${r.file_path || "?"}${r.line_number ? `:${r.line_number}` : ""}`,
        `Evidence: ${r.evidence_snippet.replace(/\n/g, " / ")}`,
        `Fix: ${r.proposed_remediation}`,
      ].join("\n");
      return block
        .split("\n")
        .map((line) => c.green(`   ${line}`))
        .join("\n");
    })
    .join("\n\n");
}

function formatFixLogCode(rows: FixLogRow[]): string {
  if (rows.length === 0) return c.dim("   (no fix-log rows for this scan)");
  const json = JSON.stringify(rows, null, 2);
  return json
    .split("\n")
    .map((line) => c.green(`   ${line}`))
    .join("\n");
}

function formatProposedFix(text: string, index: number): string {
  const m = text.match(/^\[([^\]]+)\]\s*(.+?)\s*→\s*(.+)$/);
  if (m) {
    return numberedItem(
      index,
      `[${m[1]}] ${m[2]}`,
      m[3],
      (s) => c.greenBold(s),
    );
  }
  return numberedItem(index, text.slice(0, 80), text, (s) => c.greenBold(s));
}

export function formatCliReport(report: SentinelReport): string {
  const parts: string[] = [];
  const root = report.targetPath;
  const ide = editorLabel();

  parts.push("");
  parts.push(banner("Welcome to SentinelDev — propose-only security helper"));
  parts.push("");
  parts.push(asciiLogo());
  parts.push("");
  parts.push(
    c.dim("Scan finished. Review findings carefully before applying any patch."),
  );
  parts.push(
    c.muted(
      `kind: ${report.scanKind}  ·  target: ${report.targetPath}  ·  editor: ${ide}  ·  ${report.scannedAt}`,
    ),
  );

  parts.push(sectionHeader("Summary"));
  parts.push(`  ${c.white(report.summary)}`);

  parts.push(sectionHeader("How to read this report"));
  parts.push(
    numberedItem(
      1,
      "Findings (red) = risks in your tree",
      "Each issue lists severity, Issue ID, file name, line, column, full path, and a proposed fix. Nothing was modified.",
    ),
  );
  parts.push("");
  parts.push(
    numberedItem(
      2,
      `Ctrl+click (Cmd+click) any path to open in ${ide}`,
      `Links use ${editorScheme()}://file so they open in your current IDE (${detectEditor()}), not a different editor.`,
    ),
  );
  parts.push("");
  parts.push(
    numberedItem(
      3,
      "Fix logs (green) = Supabase-ready remediations",
      "Plain log + JSON forms are both printed. Status starts as proposed.",
    ),
  );

  parts.push(sectionHeader("Findings"));
  if (report.findings.length === 0) {
    parts.push(c.dim("  No security findings for this scan."));
  } else {
    const crit = report.findings.filter((f) => f.severity === "Critical").length;
    const high = report.findings.filter((f) => f.severity === "High").length;
    parts.push(
      c.red(
        `  ${report.findings.length} issue(s)  ·  ${crit} Critical  ·  ${high} High`,
      ),
    );
    parts.push("");
    report.findings.forEach((f, i) => {
      parts.push(formatFinding(f, i + 1, root));
      parts.push("");
    });
  }

  parts.push(sectionHeader("Evidence"));
  if (report.findings.length === 0) {
    parts.push(c.dim("  No evidence snippets."));
  } else {
    report.findings.forEach((f, i) => {
      parts.push(formatEvidenceBlock(f, i + 1, root));
      parts.push("");
    });
  }

  parts.push(sectionHeader("Proposed Fixes"));
  if (report.proposedFixes.length === 0) {
    parts.push(c.dim("  No fixes proposed."));
  } else {
    report.proposedFixes.forEach((fx, i) => {
      parts.push(formatProposedFix(fx, i + 1));
      parts.push("");
    });
  }

  parts.push(sectionHeader("Optional Patch"));
  if (report.optionalPatch) {
    parts.push(
      report.optionalPatch
        .split("\n")
        .map((l) => c.violet(`  ${l}`))
        .join("\n"),
    );
  } else {
    parts.push(
      c.dim(
        "  Not generated — run: sentinel fix <issue-id>   or   sentinel ask \"apply fix\"",
      ),
    );
  }

  const rows = reportToFixLogs(report);
  parts.push(sectionHeader("Fix logs (plain)"));
  parts.push(formatFixLogPlain(rows));
  parts.push("");
  parts.push(sectionHeader("Fix logs (JSON)"));
  parts.push(
    c.dim("  Ready for public.fix_logs — green = proposed remediation payload"),
  );
  parts.push("");
  parts.push(formatFixLogCode(rows));

  parts.push(sectionHeader("Safety notes:"));
  parts.push(
    numberedItem(
      1,
      "SentinelDev never auto-modifies your codebase",
      "It only proposes remediations and optional patches. You decide what to apply.",
    ),
  );
  parts.push("");
  parts.push(
    numberedItem(
      2,
      "Always review findings before rotating keys or changing routes",
      "False positives can occur. Prefer evidence file:line over titles alone.",
    ),
  );
  parts.push("");
  parts.push(
    numberedItem(
      3,
      "Only scan repositories you are authorized to assess",
      "For IAM PDFs and policies, citations refer to document lines — not invented principals.",
    ),
  );

  parts.push("");
  parts.push(
    c.violet(
      "  Next: sentinel fix <id>  ·  sentinel install  ·  sentinel supabase",
    ),
  );
  parts.push("");

  return parts.join("\n");
}

export function formatCliHelp(): string {
  return [
    "",
    banner("Welcome to SentinelDev CLI"),
    "",
    asciiLogo(),
    "",
    c.dim("Terminal-native Secure AI helper. Propose-only. No auto-modify."),
    "",
    sectionHeader("Commands"),
    c.white("  sentinel"),
    c.dim("      Interactive AI chat (Claude-style). Auto-scans, then Nemotron analyzes."),
    "",
    c.white("  sentinel scan [path]"),
    c.dim("      Full security sweep of a directory (default: .)"),
    "",
    c.white("  sentinel scan --endpoints | --env | --db | --keys | --admin | --ossprey"),
    c.dim("      Targeted scans (can combine with a path)"),
    "",
    c.white("  sentinel ossprey [path]"),
    c.dim("      Ossprey supply-chain malware scan (npm lockfile → API)"),
    "",
    c.white("  sentinel ask \"find exposed endpoints\""),
    c.dim("      One-shot natural-language scan (non-interactive)"),
    "",
    c.white("  sentinel chat"),
    c.dim("      Same as bare 'sentinel' — open the AI REPL"),
    "",
    c.white("  sentinel explain <file>"),
    c.dim("      Explain security risks found in one file"),
    "",
    c.white("  sentinel fix <issue-id>"),
    c.dim("      Print a proposed patch for one finding (never applies it)"),
    "",
    c.white("  sentinel diff <file>"),
    c.dim("      Show proposed secure rewrite diff for a file"),
    "",
    c.white("  sentinel project"),
    c.dim("      Show project name/details used in Supabase fix logs"),
    "",
    c.white('  sentinel project set --name "MyApp" --details "..."'),
    c.dim("      Save project identity to .sentineldev/project.json"),
    "",
    c.white("  sentinel logs"),
    c.dim("      List recent fix_logs from Supabase (date, type, fixed, project)"),
    "",
    c.white("  sentinel mark-fixed <id>"),
    c.dim("      Mark a fix_log row as fixed=true"),
    "",
    c.white("  sentinel supabase"),
    c.dim("      Probe Supabase + Ossprey connection"),
    "",
    c.white("  sentinel install"),
    c.dim("      Print manual steps to install sentinel globally"),
    "",
    c.white("  sentinel modal \"deep scan...\""),
    c.dim("      Emit a Modal-ready heavy analysis task description"),
    "",
    sectionHeader("Keyword routing"),
    c.dim("  endpoint, route, public, exposed  → Endpoint Exposure Scan"),
    c.dim("  database, db, sql, mongo          → Database Exposure Scan"),
    c.dim("  env, environment, keys, secrets   → Secrets & Env Scan"),
    c.dim("  admin, debug, panel               → System Entrance Scan"),
    c.dim("  scramble, rotate                  → Key Scrambling Suggestions"),
    c.dim("  ossprey, malware, malware, sbom     → Ossprey Supply-Chain Scan"),
    c.dim("  fix, patch                        → Generate Patch (only when requested)"),
    "",
    c.violet(
      `  Tip: findings=red · fix logs=green · Ctrl+click opens in ${editorLabel()}`,
    ),
    "",
  ].join("\n");
}

/** Mandatory global install steps (plain text). */
export function formatInstallSteps(projectRoot: string): string {
  const root = projectRoot.replace(/\\/g, "/");
  return `
${banner("SentinelDev — global CLI install (manual)")}

STEP 1 — Create a CLI entry point file
--------------------------------------
The repo already ships sentinel.js at the project root:

  #!/usr/bin/env node
  // loads src/cli/index.ts via tsx

On macOS/Linux, make it executable:

  chmod +x sentinel.js

Windows: use npm bin linking (Step 2) — no chmod needed.


STEP 2 — Install SentinelDev globally
-------------------------------------
From the project folder (${root}):

  npm install
  npm install -g .

package.json bin mapping:

  "bin": {
    "sentinel": "./sentinel.js"
  }

This registers the 'sentinel' command on your PATH via npm.


STEP 3 — Add SentinelDev to PATH (if needed)
--------------------------------------------
If 'sentinel' is not found after npm install -g:

  macOS / Linux:
    sudo ln -sf "$(npm root -g)/sentineldev/sentinel.js" /usr/local/bin/sentinel
    # or:
    export PATH="$PATH:$(npm bin -g)"

  Windows (PowerShell — user PATH):
    $npmGlobal = npm config get prefix
    [Environment]::SetEnvironmentVariable("Path", $env:Path + ";$npmGlobal", "User")

Or run without global install:

  npx --yes tsx ${root}/src/cli/index.ts scan .


STEP 4 — Verify installation
----------------------------
  sentinel --help
  sentinel scan .
  sentinel scan --endpoints
  sentinel supabase


STEP 5 — Optional: shell aliases / auto-start
---------------------------------------------
Add to ~/.zshrc, ~/.bashrc, or PowerShell profile:

  alias sentinel="sentinel"

Optional watch-style reminder (manual alias):

  alias sentinel-watch='sentinel scan .'

Editor jump links:
  SENTINEL_EDITOR=cursor   # force Cursor
  SENTINEL_EDITOR=vscode   # force VS Code
  (default: auto-detect; prefers Cursor)

Supabase (.env.local — never commit):
  NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

${c.violet("After install, run:  sentinel scan .")}
`.trimStart();
}
