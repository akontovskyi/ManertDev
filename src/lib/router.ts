import type { RouteMatch, ScanKind } from "./types";

/**
 * Keyword routing — maps natural-language queries to scan kinds.
 */
export const ROUTES: RouteMatch[] = [
  {
    keyword: /\b(scramble|rotate|secure\s+keys?)\b/i,
    kind: "scramble",
    label: "Generate Key Scrambling Suggestions",
  },
  {
    keyword: /\b(iam|permissions?|policy|policies|who\s+can)\b/i,
    kind: "iam",
    label: "IBM-style IAM Reasoning",
  },
  {
    keyword: /\b(admin|debug|panel|entrance|entrances)\b/i,
    kind: "entrances",
    label: "System Entrance Scan",
  },
  {
    keyword: /\b(env|environment|keys?|secrets?|token|credential)\b/i,
    kind: "secrets",
    label: "Secrets & Env Scan",
  },
  {
    keyword: /\b(database|db|sql|mongo|postgres|mysql|redis)\b/i,
    kind: "database",
    label: "Database Exposure Scan",
  },
  {
    keyword: /\b(endpoint|route|api|public|exposed)\b/i,
    kind: "endpoints",
    label: "Endpoint Exposure Scan",
  },
];

export function routeQuery(query: string): { kind: ScanKind; label: string } {
  const q = query.trim();
  if (!q) return { kind: "full", label: "Full Security Sweep" };

  const matches = ROUTES.filter((r) => r.keyword.test(q));

  if (matches.length === 0) {
    return { kind: "full", label: "Full Security Sweep" };
  }

  if (matches.length > 1) {
    return {
      kind: "full",
      label: `Combined scan (${matches.map((m) => m.kind).join(" + ")})`,
    };
  }

  return { kind: matches[0].kind, label: matches[0].label };
}

export function wantsPatch(query: string): boolean {
  return /\b(fix|patch|apply|run\s+agent|generate\s+patch)\b/i.test(query);
}

/** Self-contained Modal task description for heavy analysis. */
export function buildModalTaskDescription(opts: {
  root: string;
  kind: ScanKind;
  query: string;
}): string {
  return [
    `SentinelDev Modal Job`,
    `====================`,
    `Target: ${opts.root}`,
    `Scan kind: ${opts.kind}`,
    `User query: ${opts.query}`,
    ``,
    `Instructions:`,
    `1. Walk the target tree (skip node_modules, .git, .next, dist, build, vendor).`,
    `2. Run the "${opts.kind}" scanner suite (endpoints, secrets, entrances, database as applicable).`,
    `3. Never invent endpoints, keys, or permissions. Cite exact file:line + snippet.`,
    `4. Never modify files. Only propose remediations and optional unified diffs.`,
    `5. Return JSON matching SentinelReport + FixLogRow[].`,
    `6. Severity: Critical | High | Medium | Low | Info.`,
  ].join("\n");
}
