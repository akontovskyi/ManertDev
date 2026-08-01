import type { Finding } from "@/lib/types";
import {
  collectSourceFiles,
  makeId,
  snippetAround,
  type SourceFile,
} from "./filesystem";

/** Patterns that often indicate HTTP route / API surface definitions. */
const ROUTE_PATTERNS: Array<{
  re: RegExp;
  riskHint: string;
  severityBoost?: "High" | "Medium" | "Low";
}> = [
  {
    re: /\b(app|router|server)\.(get|post|put|patch|delete|all|use)\s*\(\s*[`'"]([^`'"]+)[`'"]/gi,
    riskHint: "Express-style route registration",
  },
  {
    re: /\b(fastify|app)\.(get|post|put|patch|delete|route)\s*\(\s*[`'"]([^`'"]+)[`'"]/gi,
    riskHint: "Fastify-style route",
  },
  {
    re: /@(Get|Post|Put|Patch|Delete|All)\s*\(\s*[`'"]([^`'"]+)[`'"]/gi,
    riskHint: "Decorator-based controller route",
  },
  {
    re: /createBrowserRouter|createRoutesFromElements|Route\s+path\s*=\s*[`'"]([^`'"]+)[`'"]/gi,
    riskHint: "Frontend / React Router path",
    severityBoost: "Low",
  },
  {
    re: /export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/gi,
    riskHint: "Next.js App Router route handler",
  },
  {
    re: /path\s*:\s*[`'"]([^`'"]+)[`'"]/gi,
    riskHint: "Path config entry",
    severityBoost: "Low",
  },
];

const SENSITIVE_PATH =
  /(\/admin|\/debug|\/internal|\/metrics|\/healthz?|\/graphql|\/phpmyadmin|\/actuator|\/swagger|\/api-docs|\/\.env|\/console|\/wp-admin)/i;

const NO_AUTH_HINT =
  /\b(public|noAuth|skipAuth|allowAnonymous|auth\s*:\s*false|middleware:\s*\[\s*\])/i;

export async function scanEndpoints(root: string): Promise<Finding[]> {
  const files = await collectSourceFiles(root);
  const findings: Finding[] = [];

  for (const file of files) {
    findings.push(...scanFileEndpoints(file));
  }

  return dedupe(findings);
}

function scanFileEndpoints(file: SourceFile): Finding[] {
  const out: Finding[] = [];

  file.lines.forEach((line, idx) => {
    const lineNo = idx + 1;

    for (const pattern of ROUTE_PATTERNS) {
      pattern.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.re.exec(line)) !== null) {
        const pathCandidate =
          m[3] || m[2] || m[1] || extractQuoted(line) || "(dynamic)";
        const isSensitive = SENSITIVE_PATH.test(pathCandidate) || SENSITIVE_PATH.test(line);
        const unauthNearby = windowHas(file.lines, idx, 3, NO_AUTH_HINT);

        let severity: Finding["severity"] = pattern.severityBoost ?? "Medium";
        if (isSensitive) severity = "High";
        if (isSensitive && unauthNearby) severity = "Critical";

        out.push({
          id: makeId("ep", file.relativePath, lineNo),
          severity,
          category: "endpoints",
          title: isSensitive
            ? `Sensitive route may be exposed: ${pathCandidate}`
            : `Route surface detected: ${pathCandidate}`,
          description: `${pattern.riskHint}. ${
            unauthNearby
              ? "Nearby code suggests authentication may be skipped."
              : "Verify authentication and authorization on this path."
          }`,
          evidence: {
            file: file.relativePath,
            line: lineNo,
            snippet: snippetAround(file.lines, idx),
          },
          remediation: isSensitive
            ? `Protect \`${pathCandidate}\` with auth middleware, IP allowlists, or remove it from production builds. Deny by default.`
            : `Confirm least-privilege access for \`${pathCandidate}\`. Require auth for mutating methods; rate-limit public GETs.`,
          proposedPatch: isSensitive
            ? proposeAuthGuard(file.relativePath, pathCandidate)
            : undefined,
        });
      }
    }

    // Next.js route folders
    if (
      /\/route\.(ts|js|tsx|jsx)$/.test(file.relativePath) ||
      /\/(api)\//.test(file.relativePath)
    ) {
      if (line.match(/\bexport\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/)) {
        const sensitive = SENSITIVE_PATH.test(file.relativePath);
        out.push({
          id: makeId("epf", file.relativePath, lineNo),
          severity: sensitive ? "High" : "Medium",
          category: "endpoints",
          title: `API route handler in ${file.relativePath}`,
          description:
            "File-based API route is part of the public HTTP surface unless gated by middleware.",
          evidence: {
            file: file.relativePath,
            line: lineNo,
            snippet: snippetAround(file.lines, idx),
          },
          remediation:
            "Add auth checks in the handler or in `middleware.ts` matcher for this path. Reject unauthenticated requests early.",
        });
      }
    }
  });

  return out;
}

function extractQuoted(line: string): string | null {
  const m = line.match(/[`'"](\/[^`'"]*)[`'"]/);
  return m?.[1] ?? null;
}

function windowHas(
  lines: string[],
  center: number,
  radius: number,
  re: RegExp,
): boolean {
  const start = Math.max(0, center - radius);
  const end = Math.min(lines.length - 1, center + radius);
  const chunk = lines.slice(start, end + 1).join("\n");
  return re.test(chunk);
}

function proposeAuthGuard(file: string, routePath: string): string {
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@`,
    `+// ManertDev proposed guard (DO NOT apply blindly — adapt to your auth stack)`,
    `+import { requireSession } from "@/lib/auth";`,
    `+`,
    `+// Before handling ${routePath}:`,
    `+const session = await requireSession(req);`,
    `+if (!session || session.role !== "admin") {`,
    `+  return new Response("Forbidden", { status: 403 });`,
    `+}`,
  ].join("\n");
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.evidence.file}:${f.evidence.line}:${f.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
