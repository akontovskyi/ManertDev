/** Shared types for SentinelDev findings, reports, and fix logs. */

export type Severity = "Critical" | "High" | "Medium" | "Low" | "Info";

export type ScanKind =
  | "endpoints"
  | "secrets"
  | "entrances"
  | "database"
  | "scramble"
  | "iam"
  | "full";

export interface Evidence {
  file: string;
  line?: number;
  endLine?: number;
  snippet: string;
}

export interface Finding {
  id: string;
  severity: Severity;
  category: ScanKind | "general";
  title: string;
  description: string;
  evidence: Evidence;
  remediation: string;
  /** Suggested patch text (never applied automatically). */
  proposedPatch?: string;
}

export interface SentinelReport {
  summary: string;
  findings: Finding[];
  evidence: Evidence[];
  proposedFixes: string[];
  optionalPatch?: string;
  scanKind: ScanKind;
  targetPath: string;
  scannedAt: string;
}

/** Supabase-compatible fix log row. */
export interface FixLogRow {
  id?: string;
  timestamp: string;
  severity: Severity;
  description: string;
  evidence_snippet: string;
  proposed_remediation: string;
  category?: string;
  file_path?: string;
  line_number?: number;
  status?: "open" | "proposed" | "applied" | "dismissed";
  metadata?: Record<string, unknown>;
}

export interface ScanOptions {
  root: string;
  kind: ScanKind;
  query?: string;
  /** Soft file budget to keep scans responsive. */
  maxFiles?: number;
}

export interface RouteMatch {
  keyword: RegExp;
  kind: ScanKind;
  label: string;
}
