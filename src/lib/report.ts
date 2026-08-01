import fs from "node:fs";
import path from "node:path";
import type { Finding, FixLogRow, ProblemType, ProjectContext, SentinelReport } from "./types";

const PROBLEM_BY_CATEGORY: Record<string, ProblemType> = {
  endpoints: "exposed_endpoint",
  secrets: "secret_leak",
  entrances: "debug_exposure",
  database: "database_exposure",
  scramble: "misconfiguration",
  iam: "overly_permissive_iam",
  ossprey: "supply_chain_malware",
  general: "general",
};

export function inferProblemType(finding: Finding): ProblemType {
  if (finding.problemType) return finding.problemType;
  const t = `${finding.title} ${finding.description}`.toLowerCase();
  if (/inject|sql|concat/.test(t)) return "injection";
  if (/secret|api.?key|token|password|credential/.test(t)) return "secret_leak";
  if (/admin|auth|session|forbidden/.test(t)) return "weak_auth";
  if (/debug|swagger|actuator|cors/.test(t)) return "debug_exposure";
  if (/database|db|mongo|postgres|query/.test(t)) return "database_exposure";
  if (/iam|principal|policy|permission/.test(t)) return "overly_permissive_iam";
  if (/malware|malicious|supply.?chain|ossprey|dependency/.test(t))
    return "supply_chain_malware";
  return PROBLEM_BY_CATEGORY[finding.category] || "general";
}

/** Load project name/details from env + optional .sentineldev/project.json */
export function loadProjectContext(root?: string): ProjectContext {
  const base = root || process.cwd();
  let name =
    process.env.SENTINEL_PROJECT_NAME ||
    process.env.npm_package_name ||
    path.basename(base);
  let details =
    process.env.SENTINEL_PROJECT_DETAILS ||
    "SentinelDev-scanned project (set SENTINEL_PROJECT_DETAILS or .sentineldev/project.json)";

  const candidates = [
    path.join(base, ".sentineldev", "project.json"),
    path.join(base, "sentinel.project.json"),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const j = JSON.parse(fs.readFileSync(p, "utf8")) as {
        name?: string;
        details?: string;
        description?: string;
      };
      if (j.name) name = j.name;
      if (j.details || j.description) details = j.details || j.description || details;
      break;
    } catch {
      // ignore bad json
    }
  }

  // package.json name fallback
  try {
    const pkgPath = path.join(base, "package.json");
    if ((!process.env.SENTINEL_PROJECT_NAME) && fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        name?: string;
        description?: string;
      };
      if (pkg.name && name === path.basename(base)) name = pkg.name;
      if (pkg.description && details.startsWith("SentinelDev-scanned")) {
        details = pkg.description;
      }
    }
  } catch {
    // ignore
  }

  return { name, details };
}

export function saveProjectContext(
  root: string,
  ctx: ProjectContext,
): string {
  const dir = path.join(root, ".sentineldev");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, "project.json");
  fs.writeFileSync(
    dest,
    JSON.stringify(
      {
        name: ctx.name,
        details: ctx.details,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return dest;
}

/** Convert a finding into a Supabase-compatible fix log row. */
export function findingToFixLog(
  finding: Finding,
  project?: ProjectContext,
): FixLogRow {
  const now = new Date().toISOString();
  const problem_type = inferProblemType(finding);
  return {
    timestamp: now,
    detected_at: now,
    fixed_at: null,
    severity: finding.severity,
    problem_type,
    description: `${finding.title}: ${finding.description}`,
    evidence_snippet: finding.evidence.snippet,
    proposed_remediation: finding.remediation,
    project_name: project?.name ?? null,
    project_details: project?.details ?? null,
    category: finding.category,
    file_path: finding.evidence.file,
    line_number: finding.evidence.line,
    status: "proposed",
    fixed: false,
    metadata: {
      finding_id: finding.id,
      end_line: finding.evidence.endLine,
      has_patch: Boolean(finding.proposedPatch),
    },
  };
}

export function reportToFixLogs(report: SentinelReport): FixLogRow[] {
  const project = report.project || loadProjectContext(report.targetPath);
  return report.findings.map((f) => findingToFixLog(f, project));
}

/** Markdown report in the mandatory SentinelDev output shape. */
export function formatReportMarkdown(report: SentinelReport): string {
  const findingsBlock =
    report.findings.length === 0
      ? "_No security findings for this scan._"
      : report.findings
          .map(
            (f, i) =>
              `${i + 1}. **[${f.severity}]** ${f.title}\n   - ${f.description}\n   - File: \`${f.evidence.file}\`${f.evidence.line ? `:${f.evidence.line}` : ""}`,
          )
          .join("\n\n");

  const evidenceBlock =
    report.evidence.length === 0
      ? "_No evidence snippets._"
      : report.evidence
          .map(
            (e) =>
              `- \`${e.file}\`${e.line ? `:${e.line}` : ""}\n\`\`\`\n${e.snippet}\n\`\`\``,
          )
          .join("\n");

  const fixesBlock =
    report.proposedFixes.length === 0
      ? "_No fixes proposed._"
      : report.proposedFixes.map((fx, i) => `${i + 1}. ${fx}`).join("\n");

  const patchBlock = report.optionalPatch
    ? report.optionalPatch
    : "_Not generated — say **apply fix**, **generate patch**, or **run agent** to request a Cursor-ready patch._";

  const project = report.project;
  return [
    `## Summary`,
    report.summary,
    project
      ? `\nProject: ${project.name}\nDetails: ${project.details}`
      : "",
    ``,
    `## Findings`,
    findingsBlock,
    ``,
    `## Evidence`,
    evidenceBlock,
    ``,
    `## Proposed Fixes`,
    fixesBlock,
    ``,
    `## Optional Patch`,
    patchBlock,
    ``,
    `---`,
    `_scan: ${report.scanKind} · target: \`${report.targetPath}\` · at ${report.scannedAt}_`,
  ].join("\n");
}
