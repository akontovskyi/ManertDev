/**
 * Claude Code–inspired terminal report for SentinelDev.
 * Hierarchy: smart-blue banners/title → bold white titles → dim gray detail
 * Findings = red · Fix-log code = green · Actions = violet
 */

import path from "node:path";
import type { Finding, FixLogRow, SentinelReport, Severity } from "./types";
import { findingToFixLog } from "./report";

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
  /** Peach / soft orange — secondary accent */
  peach: (t: string) => wrap("38;2;232;168;124", t),
  /** Smart blue #4C71A8 — title / welcome / brand */
  smartBlue: (t: string) => wrap("38;2;76;113;168", t),
  bold: (t: string) => wrap("1", t),
  white: (t: string) => wrap("97", t),
  dim: (t: string) => wrap("38;2;160;160;160", t),
  muted: (t: string) => wrap("38;2;110;110;110", t),
  /** Findings */
  red: (t: string) => wrap("38;2;232;88;88;1", t),
  redSoft: (t: string) => wrap("38;2;200;110;110", t),
  /** Fix logs / safe remediations */
  green: (t: string) => wrap("38;2;92;200;140", t),
  greenBold: (t: string) => wrap("38;2;92;200;140;1", t),
  /** Action prompts */
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

function asciiLogo(): string {
  const sentinel = [
    "███████╗███████╗███╗   ██╗████████╗██╗███╗   ██╗███████╗██╗     ",
    "██╔════╝██╔════╝████╗  ██║╚══██╔══╝██║████╗  ██║██╔════╝██║     ",
    "███████╗█████╗  ██╔██╗ ██║   ██║   ██║██╔██╗ ██║█████╗  ██║     ",
    "╚════██║██╔══╝  ██║╚██╗██║   ██║   ██║██║╚██╗██║██╔══╝  ██║     ",
    "███████║███████╗██║ ╚████║   ██║   ██║██║ ╚████║███████╗███████╗",
    "╚══════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝",
  ].map((l) => c.smartBlue(l));

  // Shifted further right under SENTINEL
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

/**
 * Cursor / VS Code clickable location.
 * - OSC-8 hyperlink → opens editor at line (Ctrl/Cmd+click)
 * - Plain `absPath:line:col` → terminal link detector fallback
 */
function resolveAbsPath(root: string, relOrAbs: string): string {
  if (path.isAbsolute(relOrAbs)) return path.normalize(relOrAbs);
  return path.normalize(path.resolve(root, relOrAbs));
}

function toEditorUri(absPath: string, line?: number): string {
  const normalized = absPath.replace(/\\/g, "/");
  const withDrive =
    /^[A-Za-z]:/.test(normalized) && !normalized.startsWith("/")
      ? `/${normalized}`
      : normalized;
  const linePart = line && line > 0 ? `:${line}` : "";
  return `vscode://file${withDrive}${linePart}`;
}

function hyperlink(uri: string, label: string): string {
  if (!enabled) return label;
  return `${OSC}8;;${uri}${BEL}${label}${OSC}8;;${BEL}`;
}

function formatLocation(
  root: string,
  file: string,
  line?: number,
  paint: (s: string) => string = (s) => s,
): { short: string; clickable: string; jumpHint: string } {
  const abs = resolveAbsPath(root, file);
  const lineNo = line && line > 0 ? line : 1;
  const short = line ? `${file}:${line}` : file;
  const detector = `${abs}:${lineNo}:1`;
  const linkedShort = hyperlink(toEditorUri(abs, lineNo), short);
  const linkedAbs = hyperlink(toEditorUri(abs, lineNo), detector);

  return {
    short,
    clickable: paint(linkedShort),
    jumpHint: `${c.dim("Open in Cursor:")} ${paint(linkedAbs)}`,
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
  const loc = formatLocation(root, f.evidence.file, f.evidence.line, c.redSoft);
  const title = `[${f.severity}] ${f.title}`;
  const head = severityColor(f.severity, `${index}. ${title}`);
  const lines = [
    `   ${c.dim(f.description)}`,
    `   ${c.dim("Where:")} ${loc.clickable}`,
    `   ${loc.jumpHint}`,
    `   ${c.dim("Fix:")}   ${c.dim(f.remediation)}`,
  ];
  return `${head}\n${lines.join("\n")}`;
}

function formatEvidenceBlock(
  f: Finding,
  index: number,
  root: string,
): string {
  const loc = formatLocation(root, f.evidence.file, f.evidence.line, c.red);
  const head = c.red(`${index}. `) + loc.clickable;
  const jump = `   ${loc.jumpHint}`;
  const code = f.evidence.snippet
    .split("\n")
    .map((line) => c.redSoft(`   │ ${line}`))
    .join("\n");
  return `${head}\n${jump}\n${code}`;
}

function formatFixLogCode(rows: FixLogRow[]): string {
  if (rows.length === 0) {
    return c.dim("   (no fix-log rows for this scan)");
  }
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

/** Full Claude-style CLI report. */
export function formatCliReport(report: SentinelReport): string {
  const parts: string[] = [];
  const root = report.targetPath;

  parts.push("");
  parts.push(banner("Welcome to SentinelDev — propose-only security helper"));
  parts.push("");
  parts.push(asciiLogo());
  parts.push("");
  parts.push(
    c.dim(
      "Scan finished. Review findings carefully before applying any patch.",
    ),
  );
  parts.push(
    c.muted(
      `kind: ${report.scanKind}  ·  target: ${report.targetPath}  ·  ${report.scannedAt}`,
    ),
  );

  parts.push(sectionHeader("Summary"));
  parts.push(`  ${c.white(report.summary)}`);

  parts.push(sectionHeader("How to read this report"));
  parts.push(
    numberedItem(
      1,
      "Findings (red) are risks SentinelDev detected in your tree",
      "Each item shows severity, what it means, exact file:line, and a safe remediation. Nothing was modified.",
    ),
  );
  parts.push("");
  parts.push(
    numberedItem(
      2,
      "Ctrl+click (Cmd+click on macOS) any file:line to jump in Cursor",
      "Links use vscode://file paths so the IDE opens the exact line. Absolute path:line:col also works.",
    ),
  );
  parts.push("");
  parts.push(
    numberedItem(
      3,
      "Fix logs (green) are Supabase-ready records of every proposed fix",
      "Persist them to PostgreSQL, or copy the JSON into your tracker. Status starts as \"proposed\".",
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
        "  Not generated — say apply fix, generate patch, or run agent to request a Cursor-ready patch.",
      ),
    );
  }

  const rows = report.findings.map(findingToFixLog);
  parts.push(sectionHeader("Fix logs (Supabase-compatible JSON)"));
  parts.push(
    c.dim(
      "  Ready to insert into public.fix_logs — green = safe proposed remediation payload",
    ),
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
      "  Next: npm run cli -- ask \"apply fix\"   ·   open /dashboard   ·   npm run supabase:probe",
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
    c.dim("Propose-only security helper for apps in development."),
    "",
    sectionHeader("Usage"),
    numberedItem(
      1,
      "Scan a tree",
      "npm run cli -- scan [--root <path>] [--kind endpoints|secrets|entrances|database|scramble|iam|full]",
    ),
    "",
    numberedItem(
      2,
      "Ask in plain language",
      'npm run cli -- ask "are there exposed endpoints?" --root .',
    ),
    "",
    numberedItem(
      3,
      "Prepare a Modal heavy-analysis task",
      'npm run cli -- modal "deep scan endpoints and database" --root .',
    ),
    "",
    sectionHeader("Keyword routing"),
    c.dim("  endpoints, route, API, public, exposed  → Endpoint Exposure Scan"),
    c.dim("  database, db, sql, mongo                → Database Exposure Scan"),
    c.dim("  env, keys, secrets, token               → Secrets & Env Scan"),
    c.dim("  admin, debug, panel                     → System Entrance Scan"),
    c.dim("  scramble, rotate, secure keys           → Key Scrambling Suggestions"),
    c.dim("  IAM, permissions, policy, who can       → IAM Reasoning"),
    c.dim("  fix, patch, apply                       → Include Cursor Agent Patch"),
    "",
    c.violet(
      "  Tip: findings print in red · fix-log JSON prints in green · Ctrl+click file:line in Cursor",
    ),
    "",
  ].join("\n");
}
