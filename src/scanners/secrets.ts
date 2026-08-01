import type { Finding } from "@/lib/types";
import {
  collectSourceFiles,
  makeId,
  snippetAround,
  type SourceFile,
} from "./filesystem";

const SECRET_PATTERNS: Array<{
  name: string;
  re: RegExp;
  severity: Finding["severity"];
}> = [
  {
    name: "AWS Access Key ID",
    re: /\bAKIA[0-9A-Z]{16}\b/g,
    severity: "Critical",
  },
  {
    name: "Generic API key assignment",
    re: /\b(api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\b\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    severity: "Critical",
  },
  {
    name: "Bearer token literal",
    re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    severity: "Critical",
  },
  {
    name: "Slack / Discord-like token",
    re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
    severity: "Critical",
  },
  {
    name: "OpenAI-style key",
    re: /\bsk-[A-Za-z0-9]{20,}\b/g,
    severity: "Critical",
  },
  {
    name: "Private key block",
    re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    severity: "Critical",
  },
  {
    name: "Database connection string with credentials",
    re: /\b(postgres|postgresql|mysql|mongodb|mongodb\+srv|redis):\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/gi,
    severity: "Critical",
  },
  {
    name: "Hardcoded password assignment",
    re: /\b(password|passwd|pwd)\b\s*[:=]\s*['"][^'"]{4,}['"]/gi,
    severity: "High",
  },
  {
    name: "Weak / predictable env var name",
    re: /\b(SECRET|KEY|TOKEN|PASSWORD)\s*=\s*['"]?(test|secret|password|123456|changeme|admin)['"]?/gi,
    severity: "High",
  },
];

const ENV_FILE_RE = /(^|\/)\.env(\.|$)/i;

export async function scanSecrets(root: string): Promise<Finding[]> {
  const files = await collectSourceFiles(root);
  const findings: Finding[] = [];

  for (const file of files) {
    if (ENV_FILE_RE.test(file.relativePath) && !file.relativePath.endsWith(".example")) {
      findings.push({
        id: makeId("envfile", file.relativePath, 1),
        severity: "High",
        category: "secrets",
        title: `Environment file present: ${file.relativePath}`,
        description:
          "A real `.env` file was found in the tree. Ensure it is gitignored and never served statically.",
        evidence: {
          file: file.relativePath,
          line: 1,
          snippet: file.lines.slice(0, 5).join("\n").replace(/=.+/, "=***"),
        },
        remediation:
          "Keep secrets only in `.env.local` / secret managers. Commit `.env.example` with placeholders only. Verify `.gitignore` includes `.env*`.",
      });
    }

    findings.push(...scanFileSecrets(file));
  }

  return dedupe(findings);
}

function scanFileSecrets(file: SourceFile): Finding[] {
  const out: Finding[] = [];
  // Skip our own example / docs patterns lightly
  if (file.relativePath.endsWith(".example")) return out;

  file.lines.forEach((line, idx) => {
    // redact-looking placeholders are fine
    if (/YOUR_|changeme|placeholder|<.*>|example\.com/i.test(line) && !/sk-live|AKIA/.test(line)) {
      // still check strong patterns below
    }

    for (const pat of SECRET_PATTERNS) {
      pat.re.lastIndex = 0;
      if (!pat.re.test(line)) continue;
      pat.re.lastIndex = 0;

      // Avoid flagging .env.example style placeholders
      if (
        /your-|your_|example|xxx+|TODO|PLACEHOLDER|INSERT_/i.test(line) &&
        pat.severity !== "Critical"
      ) {
        continue;
      }
      if (
        file.relativePath.includes(".env.example") ||
        file.relativePath.endsWith("README.md")
      ) {
        if (pat.name.includes("Weak")) {
          // still useful
        } else if (!/AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|BEGIN .*PRIVATE KEY/.test(line)) {
          continue;
        }
      }

      const redacted = redact(line);
      out.push({
        id: makeId("sec", file.relativePath, idx + 1),
        severity: pat.severity,
        category: "secrets",
        title: `Possible secret: ${pat.name}`,
        description: `Pattern matching "${pat.name}" found in source. If real, rotate immediately and remove from VCS history.`,
        evidence: {
          file: file.relativePath,
          line: idx + 1,
          snippet: snippetAround(
            file.lines.map((l, i) => (i === idx ? redact(l) : l)),
            idx,
          ),
        },
        remediation: `Move the value to an environment variable / secret manager. Rotate the credential. Replace the literal with \`process.env.YOUR_VAR\`. Evidence (redacted): ${redacted.slice(0, 120)}`,
        proposedPatch: [
          `--- a/${file.relativePath}`,
          `+++ b/${file.relativePath}`,
          `@@`,
          `-${line.trim()}`,
          `+// value loaded from env — never hardcode`,
          `+const value = process.env.SENSITIVE_VALUE;`,
          `+if (!value) throw new Error("SENSITIVE_VALUE is not set");`,
        ].join("\n"),
      });
    }
  });

  return out;
}

function redact(line: string): string {
  return line
    .replace(/(['"])([A-Za-z0-9_\-/.+=]{6,})\1/g, "$1***$1")
    .replace(/(=)([^\s#]+)/g, "$1***")
    .slice(0, 240);
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
