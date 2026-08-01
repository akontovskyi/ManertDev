import type { Finding, ScanKind, ScanOptions, SentinelReport } from "@/lib/types";
import { wantsPatch } from "@/lib/router";
import { loadProjectContext, inferProblemType } from "@/lib/report";
import { scanEndpoints } from "./endpoints";
import { scanSecrets } from "./secrets";
import { scanEntrances } from "./entrances";
import { scanDatabase } from "./database";
import { scanScramble } from "./scramble";
import { scanOssprey } from "./ossprey";
import { analyzeIamDocument } from "./iam";

export async function runScan(options: ScanOptions): Promise<SentinelReport> {
  const { root, kind, query } = options;
  const includePatch = query ? wantsPatch(query) : false;
  const project = options.project || loadProjectContext(root);

  let findings: Finding[] = [];

  switch (kind) {
    case "endpoints":
      findings = await scanEndpoints(root);
      break;
    case "secrets":
      findings = await scanSecrets(root);
      break;
    case "entrances":
      findings = await scanEntrances(root);
      break;
    case "database":
      findings = await scanDatabase(root);
      break;
    case "scramble":
      findings = await scanScramble(root);
      break;
    case "ossprey":
      findings = await scanOssprey(root);
      break;
    case "iam":
      findings = [
        {
          id: "iam_need_doc",
          severity: "Info",
          category: "iam",
          title: "IAM analysis needs a document",
          description:
            "Upload a PDF or paste policy text via the dashboard /api/pdf endpoint. Codebase IAM scan is not applicable without a policy document.",
          evidence: { file: root, snippet: "(no IAM document provided)" },
          remediation: "Use dashboard PDF upload or POST /api/pdf with the policy text.",
        },
      ];
      break;
    case "full":
    default: {
      const local = await Promise.all([
        scanEndpoints(root),
        scanSecrets(root),
        scanEntrances(root),
        scanDatabase(root),
      ]);
      // Ossprey is optional/networked — never fail the full sweep
      let supply: Finding[] = [];
      try {
        supply = await scanOssprey(root);
      } catch (err) {
        supply = [
          {
            id: "ossprey_full_fallback",
            severity: "Info",
            category: "ossprey",
            title: "Ossprey skipped during full scan",
            description:
              err instanceof Error ? err.message : String(err),
            evidence: { file: root, snippet: "(supply-chain scan fallback)" },
            remediation: "Retry with: sentinel ossprey",
            problemType: "supply_chain_malware",
          },
        ];
      }
      findings = [...local.flat(), ...supply];
      break;
    }
  }

  findings = sortFindings(findings).map((f) => ({
    ...f,
    problemType: f.problemType || inferProblemType(f),
  }));

  const evidence = findings.map((f) => f.evidence);
  const proposedFixes = findings.map(
    (f) => `[${f.severity}] ${f.title} → ${f.remediation}`,
  );

  const optionalPatch = includePatch
    ? buildCombinedPatch(findings)
    : undefined;

  const critical = findings.filter((f) => f.severity === "Critical").length;
  const high = findings.filter((f) => f.severity === "High").length;

  const summary =
    findings.length === 0
      ? `No findings for ${kind} scan on \`${root}\` (project: ${project.name}).`
      : `SentinelDev ${kind} scan on \`${root}\` [${project.name}] found ${findings.length} issue(s)` +
        (critical || high
          ? ` (${critical} Critical, ${high} High). Propose-only — no files were modified.`
          : `. Propose-only — no files were modified.`);

  return {
    summary,
    findings,
    evidence,
    proposedFixes,
    optionalPatch,
    scanKind: kind,
    targetPath: root,
    scannedAt: new Date().toISOString(),
    project,
  };
}

export function runIamAnalysis(
  text: string,
  sourceName: string,
  question?: string,
): SentinelReport {
  const findings = sortFindings(analyzeIamDocument({ text, sourceName, question }));
  const includePatch = question ? wantsPatch(question) : false;

  return {
    summary: `IAM document analysis of \`${sourceName}\`: ${findings.length} finding(s). Citations reference exact document lines.`,
    findings,
    evidence: findings.map((f) => f.evidence),
    proposedFixes: findings.map((f) => `[${f.severity}] ${f.title} → ${f.remediation}`),
    optionalPatch: includePatch ? buildCombinedPatch(findings) : undefined,
    scanKind: "iam",
    targetPath: sourceName,
    scannedAt: new Date().toISOString(),
  };
}

function sortFindings(findings: Finding[]): Finding[] {
  const order = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 };
  return [...findings].sort(
    (a, b) => order[a.severity] - order[b.severity],
  );
}

function buildCombinedPatch(findings: Finding[]): string {
  const patches = findings
    .filter((f) => f.proposedPatch)
    .map((f) => `# Finding: ${f.title}\n${f.proposedPatch}`);

  if (patches.length === 0) {
    return [
      "```patch",
      "# SentinelDev Cursor Agent Patch",
      "# No auto-applicable hunks were generated.",
      "# Apply remediations manually from Proposed Fixes.",
      "```",
    ].join("\n");
  }

  return [
    "```patch",
    "# SentinelDev Cursor Agent Patch (PROPOSED — review before apply)",
    "# Trigger words: apply fix | generate patch | run agent",
    "# SentinelDev never auto-modifies; this block is for Cursor to execute on request.",
    "",
    ...patches,
    "```",
  ].join("\n");
}

export function kindFromString(value: string | undefined): ScanKind {
  const v = (value || "full").toLowerCase();
  const allowed: ScanKind[] = [
    "endpoints",
    "secrets",
    "entrances",
    "database",
    "scramble",
    "iam",
    "ossprey",
    "full",
  ];
  return (allowed.includes(v as ScanKind) ? v : "full") as ScanKind;
}
