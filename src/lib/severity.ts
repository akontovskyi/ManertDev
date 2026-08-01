import type { Severity } from "./types";

const RANK: Record<Severity, number> = {
  Critical: 5,
  High: 4,
  Medium: 3,
  Low: 2,
  Info: 1,
};

export function severityRank(s: Severity): number {
  return RANK[s];
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return severityRank(a) >= severityRank(b) ? a : b;
}

export function scoreLabel(s: Severity): string {
  switch (s) {
    case "Critical":
      return "direct unauthorized access or exposed secrets";
    case "High":
      return "privilege escalation or exposed admin routes";
    case "Medium":
      return "misconfigurations that weaken security";
    case "Low":
      return "best-practice improvements";
    default:
      return "informational";
  }
}
