/** Build a paste-ready agent/Cursor prompt from a SentinelDev finding. */

export type FixPromptFinding = {
  id: string;
  severity: string;
  title: string;
  description: string;
  remediation: string;
  evidence: {
    file: string;
    line?: number;
    endLine?: number;
    snippet: string;
  };
  proposedPatch?: string;
  problemType?: string;
};

export function buildFixPrompt(finding: FixPromptFinding): string {
  const loc = finding.evidence.line
    ? `${finding.evidence.file}:${finding.evidence.line}${
        finding.evidence.endLine ? `-${finding.evidence.endLine}` : ""
      }`
    : finding.evidence.file;

  const lines = [
    `Fix this security issue found by SentinelDev. Apply only the remediation below; do not change unrelated code or weaken security elsewhere.`,
    ``,
    `Issue: [${finding.severity}] ${finding.title}`,
    `ID: ${finding.id}`,
  ];

  if (finding.problemType) {
    lines.push(`Problem type: ${finding.problemType}`);
  }

  lines.push(
    `Location: ${loc}`,
    ``,
    `Description:`,
    finding.description,
    ``,
    `Evidence:`,
    "```",
    finding.evidence.snippet.trim(),
    "```",
    ``,
    `Remediation:`,
    finding.remediation,
  );

  if (finding.proposedPatch?.trim()) {
    lines.push(``, `Proposed patch (review before applying):`, "```", finding.proposedPatch.trim(), "```");
  }

  lines.push(
    ``,
    `Instructions:`,
    `1. Open ${loc} and apply the remediation (and patch if provided).`,
    `2. Keep the change minimal and least-privilege.`,
    `3. Verify the issue is resolved without breaking existing behavior.`,
    `4. Do not commit secrets or leave debug/admin surfaces exposed.`,
  );

  return lines.join("\n");
}
