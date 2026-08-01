import type { Finding } from "@/lib/types";
import { collectSourceFiles, makeId, snippetAround } from "./filesystem";
import { randomBytes } from "node:crypto";

/**
 * Suggest scrambling / rotation patterns for env keys.
 * Never invents that a key exists — only proposes based on found names.
 */
export async function scanScramble(root: string): Promise<Finding[]> {
  const files = await collectSourceFiles(root);
  const findings: Finding[] = [];
  const seenNames = new Set<string>();

  for (const file of files) {
    if (!/\.env|config|secrets?/i.test(file.relativePath) && !file.relativePath.endsWith(".ts")) {
      // still scan env-like assignments everywhere lightly
    }

    file.lines.forEach((line, idx) => {
      const m = line.match(
        /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASS|API)[A-Z0-9_]*)\s*=/,
      );
      if (!m) return;
      const name = m[1];
      if (seenNames.has(name)) return;
      seenNames.add(name);

      const suggestion = scrambleName(name);
      const sampleValue = randomBytes(24).toString("base64url");

      findings.push({
        id: makeId("scr", file.relativePath, idx + 1),
        severity: "Low",
        category: "scramble",
        title: `Key rotation / scramble suggestion for ${name}`,
        description: `Found env-style secret name \`${name}\`. Propose renaming + rotating the value (does not change files).`,
        evidence: {
          file: file.relativePath,
          line: idx + 1,
          snippet: snippetAround(
            file.lines.map((l, i) =>
              i === idx ? l.replace(/=.*/, "=***") : l,
            ),
            idx,
          ),
        },
        remediation: [
          `1. Create new secret \`${suggestion}\` in your secret manager.`,
          `2. Generate a high-entropy value (example format only): \`${sampleValue}\`.`,
          `3. Deploy dual-read (old + new) briefly, then remove \`${name}\`.`,
          `4. Rotate any credential that may have been committed historically.`,
        ].join(" "),
        proposedPatch: [
          `# .env.example (proposed rename)`,
          `- ${name}=`,
          `+ ${suggestion}=`,
        ].join("\n"),
      });
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "scr_none",
      severity: "Info",
      category: "scramble",
      title: "No secret-like env names found to scramble",
      description:
        "No KEY/SECRET/TOKEN/PASSWORD-style assignments detected. Provide a .env.example or config to scramble.",
      evidence: { file: root, snippet: "(none)" },
      remediation:
        "Maintain `.env.example` with placeholder names. Rotate secrets on a schedule; prefer secret managers over flat files.",
    });
  }

  return findings;
}

function scrambleName(name: string): string {
  const stamp = randomBytes(2).toString("hex").toUpperCase();
  // Keep semantic suffix, obscure predictable prefixes
  if (name.startsWith("NEXT_PUBLIC_")) {
    return name.replace(/^NEXT_PUBLIC_/, `NEXT_PUBLIC_APP_${stamp}_`);
  }
  return `SD_${stamp}_${name}`.replace(/__+/g, "_");
}
