/**
 * Ossprey supply-chain scanner — catalogues npm deps into OSSBOM and
 * submits them to the Ossprey malware API. Propose-only findings.
 */

import fs from "node:fs";
import path from "node:path";
import type { Finding } from "@/lib/types";
import {
  getOsspreyApiKey,
  scanSbomWithOssprey,
  type OsspreyComponent,
  type OsspreySbom,
  type OsspreyVulnerability,
} from "@/lib/ossprey";
import { makeId } from "./filesystem";

const MAX_COMPONENTS = 400;

function readJsonSafe(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function addComponent(
  map: Map<string, OsspreyComponent>,
  name: string,
  versionRaw: string | undefined,
) {
  if (!name || name.startsWith("node:")) return;
  // Skip local / URL / git specs for API purls
  const ver = (versionRaw || "").trim();
  if (
    !ver ||
    ver.startsWith("file:") ||
    ver.startsWith("link:") ||
    ver.startsWith("workspace:") ||
    ver.startsWith("git+") ||
    ver.startsWith("github:") ||
    ver.startsWith("http:") ||
    ver.startsWith("https:") ||
    ver.startsWith(".") ||
    ver.startsWith("/")
  ) {
    // Still include name-only if we have a concrete version later from lock
    if (!ver || !/^\d/.test(ver.replace(/^[\^~>=<\s]*/, ""))) return;
  }

  const version = ver.replace(/^[\^~>=<\s]*/, "").split(/\s+/)[0];
  if (!version || !/^\d/.test(version)) return;

  const purl = `pkg:npm/${encodeNpmName(name)}@${version}`;
  if (map.has(purl)) return;
  map.set(purl, {
    purl,
    name,
    version,
    type: "npm",
  });
}

function encodeNpmName(name: string): string {
  // pkg:npm/@scope/pkg → pkg:npm/%40scope/pkg
  if (name.startsWith("@")) {
    const [scope, pkg] = name.slice(1).split("/");
    return `%40${scope}/${pkg || ""}`;
  }
  return name;
}

function collectFromPackageJson(
  pkg: Record<string, unknown>,
  map: Map<string, OsspreyComponent>,
) {
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const) {
    const block = pkg[field];
    if (!block || typeof block !== "object") continue;
    for (const [name, version] of Object.entries(
      block as Record<string, string>,
    )) {
      addComponent(map, name, version);
    }
  }
}

function collectFromLockV1(
  lock: Record<string, unknown>,
  map: Map<string, OsspreyComponent>,
) {
  const deps = lock.dependencies;
  if (!deps || typeof deps !== "object") return;

  const walk = (node: Record<string, unknown>, nameHint?: string) => {
    if (nameHint && typeof node.version === "string") {
      addComponent(map, nameHint, node.version);
    }
    const nested = node.dependencies;
    if (nested && typeof nested === "object") {
      for (const [n, child] of Object.entries(
        nested as Record<string, Record<string, unknown>>,
      )) {
        walk(child, n);
      }
    }
  };

  for (const [name, child] of Object.entries(
    deps as Record<string, Record<string, unknown>>,
  )) {
    walk(child, name);
  }
}

function collectFromLockV2(
  lock: Record<string, unknown>,
  map: Map<string, OsspreyComponent>,
) {
  const packages = lock.packages;
  if (!packages || typeof packages !== "object") return;

  for (const [pkgPath, meta] of Object.entries(
    packages as Record<string, { version?: string; name?: string }>,
  )) {
    if (!pkgPath || pkgPath === "") continue; // root
    const name =
      meta.name ||
      (pkgPath.includes("node_modules/")
        ? pkgPath.split("node_modules/").pop()!
        : pkgPath);
    if (!name || name.includes("node_modules")) continue;
    addComponent(map, name, meta.version);
  }
}

export function buildNpmOssbom(root: string): {
  sbom: OsspreySbom;
  sourceFile: string;
  componentCount: number;
} {
  const map = new Map<string, OsspreyComponent>();
  let sourceFile = "package.json";

  const lockPath = [
    path.join(root, "package-lock.json"),
    path.join(root, "npm-shrinkwrap.json"),
  ].find((p) => fs.existsSync(p));

  if (lockPath) {
    sourceFile = path.basename(lockPath);
    const lock = readJsonSafe(lockPath) as Record<string, unknown> | null;
    if (lock) {
      if (lock.packages) collectFromLockV2(lock, map);
      else collectFromLockV1(lock, map);
    }
  }

  const pkgPath = path.join(root, "package.json");
  const pkg = readJsonSafe(pkgPath) as Record<string, unknown> | null;
  if (pkg) {
    if (!lockPath) sourceFile = "package.json";
    collectFromPackageJson(pkg, map);
  }

  // Also check one-level workspace package.jsons
  if (pkg?.workspaces) {
    const patterns = Array.isArray(pkg.workspaces)
      ? (pkg.workspaces as string[])
      : ((pkg.workspaces as { packages?: string[] }).packages || []);
    for (const pattern of patterns) {
      if (!pattern.includes("*")) {
        const nested = path.join(root, pattern, "package.json");
        const nestedPkg = readJsonSafe(nested) as Record<string, unknown> | null;
        if (nestedPkg) collectFromPackageJson(nestedPkg, map);
      }
    }
  }

  let components = [...map.values()];
  if (components.length > MAX_COMPONENTS) {
    components = components.slice(0, MAX_COMPONENTS);
  }

  const name =
    (pkg?.name as string | undefined) || path.basename(root) || "project";

  return {
    sbom: {
      format: "OSSBOM",
      name,
      components,
    },
    sourceFile,
    componentCount: components.length,
  };
}

function severityFromThreat(
  card?: OsspreyVulnerability["threat_card"],
): Finding["severity"] {
  const s = String(card?.severity || "High").toLowerCase();
  if (s === "critical") return "Critical";
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  if (s === "low") return "Low";
  if (s === "info") return "Info";
  return "High";
}

function findingFromVuln(
  v: OsspreyVulnerability,
  sourceFile: string,
): Finding {
  const card = v.threat_card;
  const example = card?.code_examples?.[0];
  const purl = v.purl || "unknown-package";
  const title =
    card?.threat_type ||
    `Malicious dependency: ${purl}`;
  const description = [
    card?.justification || v.description || "Ossprey flagged this package as malicious.",
    card?.mitre_techniques?.length
      ? `MITRE: ${card.mitre_techniques.join(", ")}`
      : "",
    card?.ossprey_ttps?.length
      ? `Ossprey TTPs: ${card.ossprey_ttps.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: makeId("ossprey", purl, example?.start_line || 1),
    severity: severityFromThreat(card),
    category: "ossprey",
    title,
    description,
    evidence: {
      file: example?.filename || sourceFile,
      line: example?.start_line,
      snippet: (example?.code || purl).slice(0, 400),
    },
    remediation: [
      `Remove or replace ${purl} immediately.`,
      "Pin a known-good version, rotate any secrets that package could have accessed,",
      "and re-run `sentinel ossprey` / `ossprey scan .` after cleanup.",
    ].join(" "),
    problemType: "supply_chain_malware",
  };
}

export async function scanOssprey(root: string): Promise<Finding[]> {
  const { sbom, sourceFile, componentCount } = buildNpmOssbom(root);

  if (!getOsspreyApiKey()) {
    return [
      {
        id: makeId("ossprey", "nokey", 1),
        severity: "Info",
        category: "ossprey",
        title: "Ossprey API key not configured",
        description:
          "Set OSSPREY_API_KEY in ~/.sentineldev/.env to enable supply-chain malware scans.",
        evidence: {
          file: sourceFile,
          snippet: `${componentCount} local component(s) catalogued; API skipped`,
        },
        remediation:
          "Add OSSPREY_API_KEY from https://dashboard.ossprey.com then re-run: sentinel ossprey",
        problemType: "misconfiguration",
      },
    ];
  }

  if (componentCount === 0) {
    return [
      {
        id: makeId("ossprey", "empty", 1),
        severity: "Info",
        category: "ossprey",
        title: "No npm components found for Ossprey",
        description:
          "No package.json / lockfile dependencies with resolvable versions were found.",
        evidence: {
          file: path.basename(root) || ".",
          snippet: "(no components)",
        },
        remediation:
          "Ensure package.json or package-lock.json exists with pinned dependency versions.",
        problemType: "general",
      },
    ];
  }

  try {
    const { vulnerabilities, submit } = await scanSbomWithOssprey(sbom, {
      timeoutMs: 90_000,
    });

    if (!vulnerabilities.length) {
      return [
        {
          id: makeId("ossprey", "clean", 1),
          severity: "Info",
          category: "ossprey",
          title: "Ossprey: no malware found",
          description: `Scanned ${componentCount} npm component(s) via Ossprey. No malicious packages reported.`,
          evidence: {
            file: sourceFile,
            snippet: `sbom_id=${submit.sbom_id || "(empty)"} · components=${componentCount}`,
          },
          remediation:
            "Keep lockfiles committed and re-scan when adding dependencies (`sentinel ossprey`).",
          problemType: "general",
        },
      ];
    }

    return vulnerabilities.map((v) => findingFromVuln(v, sourceFile));
  } catch (err) {
    return [
      {
        id: makeId("ossprey", "error", 1),
        severity: "Info",
        category: "ossprey",
        title: "Ossprey scan skipped (fallback)",
        description: `Ossprey API call failed — local scanners still apply. ${
          err instanceof Error ? err.message : String(err)
        }`,
        evidence: {
          file: sourceFile,
          snippet: `${componentCount} component(s) prepared for submit`,
        },
        remediation:
          "Check network/TLS, quota, and OSSPREY_API_KEY. Retry: sentinel ossprey",
        problemType: "misconfiguration",
      },
    ];
  }
}
