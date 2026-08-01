/** Shared types for ManertDev findings, reports, and fix logs. */

export type Severity = "Critical" | "High" | "Medium" | "Low" | "Info";

export type ScanKind =
  | "endpoints"
  | "secrets"
  | "entrances"
  | "database"
  | "scramble"
  | "iam"
  | "ossprey"
  | "full";

export type ProblemType =
  | "exposed_endpoint"
  | "secret_leak"
  | "weak_auth"
  | "debug_exposure"
  | "database_exposure"
  | "injection"
  | "overly_permissive_iam"
  | "supply_chain_malware"
  | "misconfiguration"
  | "general";

export interface Evidence {
  file: string;
  line?: number;
  endLine?: number;
  snippet: string;
}

export interface Finding {
  id: string;
  severity: Severity;
  category: ScanKind | "general" | "ossprey";
  title: string;
  description: string;
  evidence: Evidence;
  remediation: string;
  /** Suggested patch text (never applied automatically). */
  proposedPatch?: string;
  problemType?: ProblemType;
}

export interface ProjectContext {
  name: string;
  details: string;
}

export interface ManertReport {
  summary: string;
  findings: Finding[];
  evidence: Evidence[];
  proposedFixes: string[];
  optionalPatch?: string;
  scanKind: ScanKind;
  targetPath: string;
  scannedAt: string;
  project?: ProjectContext;
}

/** Supabase-compatible fix log row. */
export interface FixLogRow {
  id?: string;
  /** ISO timestamp — when logged / detected */
  timestamp: string;
  detected_at?: string;
  fixed_at?: string | null;
  severity: Severity;
  /** e.g. exposed_endpoint, secret_leak, injection */
  problem_type: ProblemType | string;
  description: string;
  evidence_snippet: string;
  proposed_remediation: string;
  project_name?: string | null;
  project_details?: string | null;
  category?: string;
  file_path?: string;
  line_number?: number;
  status?: "open" | "proposed" | "applied" | "fixed" | "dismissed";
  /** true when the issue has been remediated */
  fixed?: boolean;
  metadata?: Record<string, unknown>;
}

export interface ScanOptions {
  root: string;
  kind: ScanKind;
  query?: string;
  /** Soft file budget to keep scans responsive. */
  maxFiles?: number;
  project?: ProjectContext;
}

export interface RouteMatch {
  keyword: RegExp;
  kind: ScanKind;
  label: string;
}
