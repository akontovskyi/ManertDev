import type { Finding } from "@/lib/types";

/**
 * IBM Challenge–style IAM / policy reasoning over extracted PDF (or plain) text.
 * Deterministic heuristics + citations — no hallucinated principals.
 */

export interface IamAnalysisInput {
  text: string;
  sourceName: string;
  question?: string;
}

interface PolicyHit {
  line: number;
  text: string;
}

export function analyzeIamDocument(input: IamAnalysisInput): Finding[] {
  const lines = input.text.split(/\r?\n/);
  const findings: Finding[] = [];
  const question = (input.question || "").toLowerCase();

  const starActions = findLines(lines, /("Action"\s*:\s*"\*"|"Action"\s*:\s*\[\s*"\*"\s*\])/i);
  const starResource = findLines(lines, /("Resource"\s*:\s*"\*"|"Resource"\s*:\s*\[\s*"\*"\s*\])/i);
  const allowAll = findLines(lines, /"Effect"\s*:\s*"Allow"/i);
  const wildcardPrincipal = findLines(lines, /("Principal"\s*:\s*"\*"|"AWS"\s*:\s*"\*"|Principal\s*=\s*\*)/i);
  const publicAcl = findLines(lines, /(AllUsers|AllAuthenticatedUsers|public-read|acl.*public)/i);
  const adminManaged = findLines(lines, /(AdministratorAccess|arn:aws:iam::aws:policy\/Admin)/i);

  for (const hit of starActions) {
    findings.push(
      makeFinding({
        severity: "Critical",
        title: "Overly permissive Action: *",
        description: "Policy grants all actions. This violates least privilege.",
        sourceName: input.sourceName,
        hit,
        remediation:
          "Replace Action `*` with the minimal set of required actions (e.g. `s3:GetObject`).",
      }),
    );
  }

  for (const hit of starResource) {
    findings.push(
      makeFinding({
        severity: "High",
        title: "Overly permissive Resource: *",
        description: "Policy applies to all resources.",
        sourceName: input.sourceName,
        hit,
        remediation: "Scope Resource ARNs to specific buckets, queues, or tables.",
      }),
    );
  }

  for (const hit of wildcardPrincipal) {
    findings.push(
      makeFinding({
        severity: "Critical",
        title: "Principal is wildcard (*)",
        description: "Anyone (or any AWS principal) may be trusted by this statement.",
        sourceName: input.sourceName,
        hit,
        remediation:
          "Pin Principal to specific IAM roles/users/accounts. Add conditions (IpAddress, StringEquals).",
      }),
    );
  }

  for (const hit of publicAcl) {
    findings.push(
      makeFinding({
        severity: "Critical",
        title: "Public access indicator",
        description: "Document references public ACL / AllUsers-style access.",
        sourceName: input.sourceName,
        hit,
        remediation: "Remove public ACLs; use private buckets + signed URLs or CloudFront OAC.",
      }),
    );
  }

  for (const hit of adminManaged) {
    findings.push(
      makeFinding({
        severity: "High",
        title: "Administrator-level policy reference",
        description: "Admin managed policy detected — broad blast radius if attached widely.",
        sourceName: input.sourceName,
        hit,
        remediation:
          "Attach AdministratorAccess only to break-glass roles with MFA and short sessions.",
      }),
    );
  }

  // Question-specific answers as Info findings with citations
  if (/who\s+can|who\s+has\s+access|principal/i.test(question)) {
    const principals = findLines(
      lines,
      /("Principal"|Principal|Role|User|Group|ServiceAccount|member\s*:)/i,
    );
    if (principals.length === 0) {
      findings.push({
        id: `iam_who_unknown`,
        severity: "Info",
        category: "iam",
        title: "Could not determine principals from document",
        description:
          "No clear Principal/Role/User lines found. Uncertainty stated — do not invent identities.",
        evidence: {
          file: input.sourceName,
          snippet: lines.slice(0, 8).join("\n").slice(0, 400) || "(empty)",
        },
        remediation: "Provide a full IAM policy JSON or access review export.",
      });
    } else {
      for (const hit of principals.slice(0, 8)) {
        findings.push(
          makeFinding({
            severity: "Info",
            title: "Access principal citation",
            description: `Possible accessor referenced: ${hit.text.trim().slice(0, 160)}`,
            sourceName: input.sourceName,
            hit,
            remediation: "Verify this principal still needs access; remove stale grants.",
          }),
        );
      }
    }
  }

  if (/overly\s+permissive|too\s+open|least\s+privilege/i.test(question)) {
    if (starActions.length || starResource.length || wildcardPrincipal.length) {
      findings.push({
        id: "iam_overpermissive_yes",
        severity: "High",
        category: "iam",
        title: "Yes — document appears overly permissive",
        description: `Found ${starActions.length} Action:* , ${starResource.length} Resource:* , ${wildcardPrincipal.length} Principal:* indicators.`,
        evidence: {
          file: input.sourceName,
          line: (starActions[0] || starResource[0] || wildcardPrincipal[0])?.line,
          snippet: (starActions[0] || starResource[0] || wildcardPrincipal[0])?.text || "",
        },
        remediation: "Tighten Action, Resource, and Principal; add Condition blocks.",
      });
    } else if (allowAll.length && findings.length === 0) {
      findings.push({
        id: "iam_allow_review",
        severity: "Medium",
        category: "iam",
        title: "Allow statements present — review scope",
        description:
          "Allow Effects found without obvious wildcards. Still verify resources and conditions.",
        evidence: {
          file: input.sourceName,
          line: allowAll[0]?.line,
          snippet: allowAll[0]?.text || "",
        },
        remediation: "Confirm each Allow is necessary and correctly conditioned.",
      });
    } else if (findings.length === 0) {
      findings.push({
        id: "iam_not_obvious",
        severity: "Info",
        category: "iam",
        title: "No obvious over-permissive wildcards detected",
        description:
          "Heuristic scan found no Action/Resource/Principal wildcards. Manual review still recommended.",
        evidence: {
          file: input.sourceName,
          snippet: lines.slice(0, 12).join("\n").slice(0, 500),
        },
        remediation: "Run a full IAM Access Analyzer review in the cloud account.",
      });
    }
  }

  if (findings.length === 0) {
    findings.push({
      id: "iam_empty",
      severity: "Info",
      category: "iam",
      title: "IAM heuristics returned no hits",
      description:
        "Document did not match common over-permissive IAM patterns. If this is not IAM JSON, paste policy text or ask a specific question.",
      evidence: {
        file: input.sourceName,
        snippet: lines.slice(0, 15).join("\n").slice(0, 500) || "(empty document)",
      },
      remediation: "Ask: “Who can access this resource?” or “Is this overly permissive?”",
    });
  }

  return findings;
}

function findLines(lines: string[], re: RegExp): PolicyHit[] {
  const hits: PolicyHit[] = [];
  lines.forEach((text, i) => {
    if (re.test(text)) hits.push({ line: i + 1, text: text.slice(0, 300) });
  });
  return hits;
}

function makeFinding(opts: {
  severity: Finding["severity"];
  title: string;
  description: string;
  sourceName: string;
  hit: PolicyHit;
  remediation: string;
}): Finding {
  return {
    id: `iam_${opts.hit.line}_${opts.title.slice(0, 20).replace(/\s+/g, "_")}`,
    severity: opts.severity,
    category: "iam",
    title: opts.title,
    description: opts.description,
    evidence: {
      file: opts.sourceName,
      line: opts.hit.line,
      snippet: opts.hit.text,
    },
    remediation: opts.remediation,
  };
}
