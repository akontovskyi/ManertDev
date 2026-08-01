import type { Finding, FixLogRow, SentinelReport } from "./types";

/** Convert a finding into a Supabase-compatible fix log row. */
export function findingToFixLog(finding: Finding): FixLogRow {
  return {
    timestamp: new Date().toISOString(),
    severity: finding.severity,
    description: `${finding.title}: ${finding.description}`,
    evidence_snippet: finding.evidence.snippet,
    proposed_remediation: finding.remediation,
    category: finding.category,
    file_path: finding.evidence.file,
    line_number: finding.evidence.line,
    status: "proposed",
    metadata: {
      finding_id: finding.id,
      end_line: finding.evidence.endLine,
      has_patch: Boolean(finding.proposedPatch),
    },
  };
}

export function reportToFixLogs(report: SentinelReport): FixLogRow[] {
  return report.findings.map(findingToFixLog);
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

  return [
    `## Summary`,
    report.summary,
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
