import type { ManertReport } from "./types";

/** Compact scan payload for LLM context (cite-only; do not invent). */
export function compactReport(report: ManertReport) {
  return {
    summary: report.summary,
    scanKind: report.scanKind,
    targetPath: report.targetPath,
    findings: report.findings.slice(0, 20).map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      description: f.description,
      file: f.evidence.file,
      line: f.evidence.line,
      snippet: f.evidence.snippet,
      remediation: f.remediation,
    })),
  };
}
