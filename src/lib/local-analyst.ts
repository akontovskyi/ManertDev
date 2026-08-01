/**
 * Local analyst — deterministic security reasoning with ZERO LLM calls.
 * This is the core of SentinelDev. NVIDIA/Nemotron is optional narration only.
 */

import type { Finding, SentinelReport, Severity } from "./types";

const RANK: Record<Severity, number> = {
  Critical: 100,
  High: 70,
  Medium: 40,
  Low: 15,
  Info: 5,
};

export interface LocalAnalysis {
  riskScore: number;
  riskLabel: "Critical" | "High" | "Elevated" | "Low" | "Clear";
  headline: string;
  priorityQueue: Finding[];
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  actions: string[];
  offlineNarrative: string;
}

export function analyzeLocally(report: SentinelReport): LocalAnalysis {
  const findings = [...report.findings];
  const bySeverity: Record<string, number> = {};
  const byCategory: Record<string, number> = {};

  let score = 0;
  for (const f of findings) {
    score += RANK[f.severity] || 0;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
  }

  // Soft cap for readability
  const riskScore = Math.min(100, Math.round(score / Math.max(1, findings.length || 1) + Math.min(40, findings.length * 3)));

  let riskLabel: LocalAnalysis["riskLabel"] = "Clear";
  if (bySeverity.Critical) riskLabel = "Critical";
  else if (bySeverity.High) riskLabel = "High";
  else if (bySeverity.Medium) riskLabel = "Elevated";
  else if (findings.length) riskLabel = "Low";

  const priorityQueue = findings
    .slice()
    .sort((a, b) => (RANK[b.severity] || 0) - (RANK[a.severity] || 0))
    .slice(0, 10);

  const actions = buildActions(priorityQueue);

  const headline =
    findings.length === 0
      ? `Local scan clear on ${report.targetPath} (${report.scanKind}).`
      : `Local engine found ${findings.length} issue(s) — risk ${riskLabel} (score ${riskScore}/100).`;

  const offlineNarrative = buildOfflineNarrative(report, {
    riskScore,
    riskLabel,
    headline,
    priorityQueue,
    byCategory,
    bySeverity,
    actions,
    offlineNarrative: "",
  });

  return {
    riskScore,
    riskLabel,
    headline,
    priorityQueue,
    byCategory,
    bySeverity,
    actions,
    offlineNarrative,
  };
}

function buildActions(priority: Finding[]): string[] {
  const out: string[] = [];
  for (const f of priority.slice(0, 5)) {
    const loc = f.evidence.line
      ? `${f.evidence.file}:${f.evidence.line}`
      : f.evidence.file;
    out.push(`[${f.severity}] ${loc} — ${f.remediation}`);
  }
  if (!out.length) {
    out.push("No remediation actions required from this scan.");
  }
  return out;
}

function buildOfflineNarrative(
  report: SentinelReport,
  analysis: LocalAnalysis,
): string {
  const lines: string[] = [];
  lines.push(analysis.headline);
  lines.push("");
  lines.push(`Scan kind: ${report.scanKind}`);
  lines.push(`Target:    ${report.targetPath}`);
  lines.push(`Time:      ${report.scannedAt}`);
  lines.push("");

  if (analysis.priorityQueue.length === 0) {
    lines.push("No exposure patterns matched the local rule engines.");
    lines.push("Engines checked: endpoints, secrets, entrances, database (as applicable).");
    lines.push("This result did NOT require any cloud AI call.");
    return lines.join("\n");
  }

  lines.push("Priority queue (local ranking — no AI):");
  analysis.priorityQueue.forEach((f, i) => {
    const loc = f.evidence.line
      ? `${f.evidence.file}:${f.evidence.line}`
      : f.evidence.file;
    lines.push(`${i + 1}. [${f.severity}] ${f.title}`);
    lines.push(`   Where: ${loc}`);
    lines.push(`   Why:   ${f.description}`);
    lines.push(`   Fix:   ${f.remediation}`);
  });

  lines.push("");
  lines.push("Category counts:");
  for (const [k, v] of Object.entries(analysis.byCategory)) {
    lines.push(`  ${k}: ${v}`);
  }

  lines.push("");
  lines.push("Next actions:");
  analysis.actions.forEach((a, i) => lines.push(`${i + 1}. ${a}`));

  lines.push("");
  lines.push(
    "Engine note: findings above were produced by local static scanners in src/scanners/*.",
  );
  lines.push(
    "NVIDIA/Nemotron is optional — it only narrates; it does not invent these hits.",
  );

  return lines.join("\n");
}

/** True when a question can be answered fully offline from scan evidence. */
export function canAnswerOffline(userText: string): boolean {
  return /\b(scan|find|list|show|exposed|endpoint|secret|key|env|database|admin|debug|risk|what|where)\b/i.test(
    userText,
  );
}
