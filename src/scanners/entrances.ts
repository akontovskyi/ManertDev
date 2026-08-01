import type { Finding } from "@/lib/types";
import {
  collectSourceFiles,
  makeId,
  snippetAround,
  type SourceFile,
} from "./filesystem";

const ENTRANCE_PATTERNS: Array<{
  title: string;
  re: RegExp;
  severity: Finding["severity"];
  remediation: string;
}> = [
  {
    title: "Admin panel / route reference",
    re: /\b(\/admin|adminPanel|AdminDashboard|wp-admin|django\.contrib\.admin)\b/gi,
    severity: "High",
    remediation:
      "Gate admin surfaces behind strong auth + MFA, separate host if possible, and audit every action.",
  },
  {
    title: "Debug endpoint / mode",
    re: /\b(debug\s*=\s*True|NODE_ENV\s*=\s*['"]development['"]|\/debug|debugEndpoint|app\.debug\s*=\s*true)\b/gi,
    severity: "High",
    remediation:
      "Ensure debug modes and debug routes are disabled in production builds and behind feature flags.",
  },
  {
    title: "Swagger / OpenAPI UI",
    re: /\b(\/swagger|swagger-ui|\/api-docs|Scalar\.|swaggerUi)\b/gi,
    severity: "Medium",
    remediation:
      "Disable API docs in production or protect with auth. Avoid exposing internal schemas publicly.",
  },
  {
    title: "Actuator / metrics exposure",
    re: /\b(\/actuator|\/metrics|\/prometheus|express-status-monitor)\b/gi,
    severity: "Medium",
    remediation:
      "Bind metrics to internal networks only; require auth; strip sensitive labels.",
  },
  {
    title: "CORS allow-all",
    re: /Access-Control-Allow-Origin['":\s]+['"]?\*['"]?|origin:\s*true|cors\(\s*\{[^}]*origin:\s*['"]\*['"]/gi,
    severity: "Medium",
    remediation:
      "Replace wildcard CORS with an explicit allowlist of trusted origins.",
  },
  {
    title: "Listen on all interfaces without guard note",
    re: /\b(listen\(\s*\d+|host:\s*['"]0\.0\.0\.0['"]|HOSTNAME\s*=\s*0\.0\.0\.0)/gi,
    severity: "Low",
    remediation:
      "Confirm binding to 0.0.0.0 is intentional and firewalled. Prefer localhost for local-only services.",
  },
  {
    title: "Dangerous eval / dynamic code",
    re: /\b(eval\s*\(|new\s+Function\s*\(|child_process\.(exec|execSync)\s*\()/gi,
    severity: "High",
    remediation:
      "Remove eval/exec where possible. If required, sandbox inputs and use allowlisted commands.",
  },
];

export async function scanEntrances(root: string): Promise<Finding[]> {
  const files = await collectSourceFiles(root);
  const findings: Finding[] = [];

  for (const file of files) {
    findings.push(...scanFile(file));
  }

  for (const file of files) {
    if (!/docker-compose|Dockerfile|package\.json/i.test(file.relativePath)) continue;
    file.lines.forEach((line, idx) => {
      const port = line.match(/\b(?:PORT|ports?)\b[^0-9]*(\d{2,5})/i);
      if (port) {
        findings.push({
          id: makeId("port", file.relativePath, idx + 1),
          severity: "Info",
          category: "entrances",
          title: `Service port hint: ${port[1]}`,
          description:
            "Potential network entrance. Confirm it is not published beyond the intended trust boundary.",
          evidence: {
            file: file.relativePath,
            line: idx + 1,
            snippet: snippetAround(file.lines, idx),
          },
          remediation:
            "Document the trust boundary for this port. Use firewall / compose `expose` vs `ports` correctly.",
        });
      }
    });
  }

  return dedupe(findings);
}

function scanFile(file: SourceFile): Finding[] {
  const out: Finding[] = [];
  file.lines.forEach((line, idx) => {
    for (const pat of ENTRANCE_PATTERNS) {
      pat.re.lastIndex = 0;
      if (!pat.re.test(line)) continue;
      out.push({
        id: makeId("ent", file.relativePath, idx + 1),
        severity: pat.severity,
        category: "entrances",
        title: pat.title,
        description: `System entrance indicator matched in ${file.relativePath}.`,
        evidence: {
          file: file.relativePath,
          line: idx + 1,
          snippet: snippetAround(file.lines, idx),
        },
        remediation: pat.remediation,
      });
    }
  });
  return out;
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
