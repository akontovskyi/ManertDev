import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { loadEnvFiles } from "@/lib/env";
import { analyzeLocally } from "@/lib/local-analyst";
import {
  MANERT_SYSTEM_PROMPT,
  getNvidiaConfig,
  isSecurityQuestion,
  streamManertChat,
} from "@/lib/nvidia";
import { formatReportMarkdown, reportToFixLogs } from "@/lib/report";
import { routeQuery } from "@/lib/router";
import { compactReport } from "@/lib/scan-evidence";
import { persistFixLogs } from "@/lib/supabase";
import type { Finding, ManertReport } from "@/lib/types";
import { runScan } from "@/scanners";

export const runtime = "nodejs";
export const maxDuration = 120;

function resolveScanRoot(rootInput: string): string {
  if (path.isAbsolute(rootInput)) return path.normalize(rootInput);
  return path.resolve(process.cwd(), rootInput || ".");
}

function sanitizeHistory(
  raw: unknown,
): ChatCompletionMessageParam[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatCompletionMessageParam[] = [];
  for (const item of raw.slice(-16)) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: string }).role;
    const content = String((item as { content?: unknown }).content || "").trim();
    if (!content) continue;
    if (role === "user" || role === "assistant") {
      out.push({ role, content });
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    loadEnvFiles();

    const body = await req.json();
    const query = String(body.query || "").trim();
    const rootInput = String(body.root || process.env.MANERT_SCAN_ROOT || ".");
    const root = resolveScanRoot(rootInput);
    const prior = sanitizeHistory(body.history);

    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const security = isSecurityQuestion(query);
    const preferFallback = !security;
    const routed = routeQuery(query);

    let report: ManertReport | null = null;
    let findings: Finding[] = [];
    let reportMarkdown = "";
    let persist: Awaited<ReturnType<typeof persistFixLogs>> | null = null;
    let scanError: string | null = null;

    if (security) {
      try {
        report = await runScan({
          root,
          kind: routed.kind === "iam" ? "full" : routed.kind,
          query,
        });
        findings = report.findings;
        reportMarkdown = formatReportMarkdown(report);
        const fixLogs = reportToFixLogs(report);
        persist = await persistFixLogs(fixLogs);
      } catch (err) {
        scanError = err instanceof Error ? err.message : String(err);
      }
    }

    const modelReady = Boolean(getNvidiaConfig({ preferFallback }));

    if (!modelReady) {
      const offline =
        reportMarkdown ||
        (report
          ? analyzeLocally(report).offlineNarrative
          : [
              "Model offline — no LLM keys configured.",
              "Add OPENROUTER_API_KEY and/or OPENROUTER_FALLBACK_API_KEY to ~/.manertdev/.env, then restart the dashboard.",
              security
                ? "Local scanners still work for keyword security asks once keys are set."
                : "General chat needs a model key.",
            ].join("\n"));

      return NextResponse.json({
        reply: offline,
        markdown: offline,
        reportMarkdown: reportMarkdown || undefined,
        routed,
        summary: report?.summary,
        findings,
        persist,
        model: false,
        preferFallback,
        scanError,
      });
    }

    const evidenceBlock =
      report && !scanError
        ? [
            "",
            "SCAN_EVIDENCE_JSON (cite these if relevant; do not invent):",
            JSON.stringify(compactReport(report), null, 2),
            "",
            "LOCAL_RANKING:",
            analyzeLocally(report).offlineNarrative,
          ].join("\n")
        : scanError
          ? `\nLocal scan failed (${scanError}). Explain what that scan usually looks for and how to retry.`
          : "";

    const userContent = [
      query,
      "",
      `Context: cwd=${root} · time=${new Date().toISOString()} · nonce=${Math.random().toString(36).slice(2, 8)}`,
      preferFallback
        ? "Mode: general chat (fallback model key preferred)."
        : "Mode: security assist (primary model key preferred).",
      "Reply in a natural, unique way. Do not reuse prior phrasing.",
      evidenceBlock,
    ]
      .filter(Boolean)
      .join("\n");

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: MANERT_SYSTEM_PROMPT },
      ...prior,
      { role: "user", content: userContent },
    ];

    const reply = await streamManertChat({
      messages,
      temperature: 1.05,
      maxTokens: 4096,
      preferFallback,
    });

    return NextResponse.json({
      reply,
      markdown: reply,
      reportMarkdown: reportMarkdown || undefined,
      routed,
      summary: report?.summary,
      findings,
      persist,
      model: true,
      preferFallback,
      scanError,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "chat failed" },
      { status: 500 },
    );
  }
}
