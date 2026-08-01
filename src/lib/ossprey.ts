/**
 * Ossprey supply-chain malware API client.
 * Auth: x-api-key (OSSPREY_API_KEY). Secrets live in ~/.manertdev/.env.
 * Docs: https://docs.ossprey.com/docs/api-quickstart
 */

export type OsspreyComponent = {
  purl: string;
  name: string;
  version?: string;
  type: "npm" | "pypi" | string;
};

export type OsspreySbom = {
  format: "OSSBOM";
  name?: string;
  components: OsspreyComponent[];
};

export type OsspreyThreatCard = {
  severity?: string;
  threat_type?: string;
  justification?: string;
  code_examples?: Array<{
    code?: string;
    filename?: string;
    language?: string;
    start_line?: number;
  }>;
  mitre_techniques?: string[];
  ossprey_ttps?: string[];
};

export type OsspreyVulnerability = {
  id?: string;
  purl?: string;
  description?: string;
  status?: string;
  threat_card?: OsspreyThreatCard;
};

export type OsspreyScanSubmit = {
  sbom_id: string;
  scan_id: string;
  status: string;
};

export type OsspreyScanResult = {
  status: string;
  output?: {
    components?: OsspreyComponent[];
    vulnerabilities?: OsspreyVulnerability[];
    [key: string]: unknown;
  };
  error?: string;
  message?: string;
};

function baseUrl(): string {
  return (
    process.env.OSSPREY_API_URL ||
    process.env.OSSPREY_BASE_URL ||
    "https://api.ossprey.com"
  ).replace(/\/$/, "");
}

export function getOsspreyApiKey(): string | undefined {
  return process.env.OSSPREY_API_KEY || process.env.OSPREY_API_KEY;
}

export function getOsspreyConfigStatus(): {
  configured: boolean;
  baseUrl: string;
  keyPresent: boolean;
} {
  const key = getOsspreyApiKey();
  return {
    configured: Boolean(key),
    baseUrl: baseUrl(),
    keyPresent: Boolean(key),
  };
}

function headers(): HeadersInit {
  const key = getOsspreyApiKey();
  if (!key) throw new Error("OSSPREY_API_KEY not set in ~/.manertdev/.env");
  return {
    "x-api-key": key,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

export async function probeOssprey(): Promise<{
  ok: boolean;
  message: string;
  details?: unknown;
}> {
  try {
    const health = await fetch(`${baseUrl()}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(12_000),
    });
    const healthBody = await readJson(health);
    if (!health.ok) {
      return {
        ok: false,
        message: `Ossprey /health HTTP ${health.status}`,
        details: healthBody,
      };
    }

    if (!getOsspreyApiKey()) {
      return {
        ok: true,
        message:
          "Ossprey API reachable, but OSSPREY_API_KEY is missing in ~/.manertdev/.env",
        details: { health: healthBody, keyPresent: false },
      };
    }

    // Authenticated smoke: list scans (empty list is fine)
    const list = await fetch(`${baseUrl()}/public/v1/scans`, {
      method: "GET",
      headers: headers(),
      signal: AbortSignal.timeout(15_000),
    });
    const listBody = await readJson(list);
    if (!list.ok) {
      return {
        ok: false,
        message: `Ossprey auth failed (HTTP ${list.status})`,
        details: listBody,
      };
    }

    return {
      ok: true,
      message: `Ossprey connected (${baseUrl()})`,
      details: { health: healthBody },
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function submitOsspreyScan(
  sbom: OsspreySbom,
): Promise<OsspreyScanSubmit> {
  const res = await fetch(`${baseUrl()}/public/v1/scans`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ sbom }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await readJson(res)) as OsspreyScanSubmit & {
    error?: string;
    message?: string;
  };

  if (res.status === 200 && !body.sbom_id) {
    // Empty components — accepted with nothing to scan
    return {
      sbom_id: "",
      scan_id: "",
      status: "SUCCEEDED",
    };
  }

  if (res.status !== 202 && res.status !== 200) {
    throw new Error(
      body.error ||
        body.message ||
        `Ossprey submit failed (HTTP ${res.status})`,
    );
  }

  if (!body.sbom_id || !body.scan_id) {
    throw new Error("Ossprey submit response missing sbom_id/scan_id");
  }

  return {
    sbom_id: body.sbom_id,
    scan_id: body.scan_id,
    status: body.status || "QUEUED",
  };
}

export async function getOsspreyScanStatus(
  sbomId: string,
  scanId: string,
): Promise<{ httpStatus: number; body: OsspreyScanResult }> {
  const url = new URL(`${baseUrl()}/public/v1/scans/status`);
  url.searchParams.set("sbom_id", sbomId);
  url.searchParams.set("scan_id", scanId);

  const res = await fetch(url, {
    method: "GET",
    headers: headers(),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await readJson(res)) as OsspreyScanResult;
  return { httpStatus: res.status, body };
}

export async function waitForOsspreyScan(
  sbomId: string,
  scanId: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<OsspreyScanResult> {
  if (!sbomId || !scanId) {
    return { status: "SUCCEEDED", output: { vulnerabilities: [] } };
  }

  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const intervalMs = opts?.intervalMs ?? 2_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const { httpStatus, body } = await getOsspreyScanStatus(sbomId, scanId);

    if (httpStatus === 200 && body.status === "SUCCEEDED") {
      return body;
    }
    if (httpStatus === 400 || body.status === "FAILED") {
      throw new Error(
        body.error || body.message || `Ossprey scan failed (${body.status})`,
      );
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Ossprey scan timed out after ${Math.round(timeoutMs / 1000)}s (sbom=${sbomId})`,
  );
}

/** Submit OSSBOM and wait for malware verdicts. */
export async function scanSbomWithOssprey(
  sbom: OsspreySbom,
  opts?: { timeoutMs?: number },
): Promise<{
  submit: OsspreyScanSubmit;
  result: OsspreyScanResult;
  vulnerabilities: OsspreyVulnerability[];
}> {
  const submit = await submitOsspreyScan(sbom);
  const result = await waitForOsspreyScan(submit.sbom_id, submit.scan_id, {
    timeoutMs: opts?.timeoutMs,
  });
  const vulnerabilities = result.output?.vulnerabilities || [];
  return { submit, result, vulnerabilities };
}
