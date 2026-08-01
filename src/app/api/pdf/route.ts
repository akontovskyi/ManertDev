import { NextRequest, NextResponse } from "next/server";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { loadEnvFiles } from "@/lib/env";
import { analyzeLocally } from "@/lib/local-analyst";
import {
  SENTINEL_SYSTEM_PROMPT,
  getNvidiaConfig,
  streamSentinelChat,
} from "@/lib/nvidia";
import { formatReportMarkdown, reportToFixLogs } from "@/lib/report";
import { compactReport } from "@/lib/scan-evidence";
import { persistFixLogs } from "@/lib/supabase";
import { runIamAnalysis } from "@/scanners";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    loadEnvFiles();

    const contentType = req.headers.get("content-type") || "";
    let text = "";
    let sourceName = "pasted-policy.txt";
    let question = "Is this overly permissive? Who can access this resource?";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      question = String(form.get("question") || question);
      if (file && typeof file === "object" && "arrayBuffer" in file) {
        const f = file as File;
        sourceName = f.name || sourceName;
        const buf = Buffer.from(await f.arrayBuffer());
        if (f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf") {
          const pdfParse = (await import("pdf-parse")).default;
          const parsed = await pdfParse(buf);
          text = parsed.text || "";
        } else {
          text = buf.toString("utf8");
        }
      }
    } else {
      const body = await req.json();
      text = String(body.text || "");
      sourceName = String(body.sourceName || sourceName);
      question = String(body.question || question);
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "No document text extracted. Upload a PDF or paste policy text." },
        { status: 400 },
      );
    }

    const report = runIamAnalysis(text, sourceName, question);
    const fixLogs = reportToFixLogs(report);
    const persist = await persistFixLogs(fixLogs);
    const reportMarkdown = formatReportMarkdown(report);

    const modelReady = Boolean(getNvidiaConfig({ preferFallback: false }));
    if (!modelReady) {
      return NextResponse.json({
        reply: reportMarkdown,
        markdown: reportMarkdown,
        summary: report.summary,
        findings: report.findings,
        fixLogs,
        persist,
        model: false,
      });
    }

    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: SENTINEL_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `IAM / policy analysis for ${sourceName}.`,
          `User question: ${question}`,
          ``,
          `Give a sharp IBM-style IAM read: who can access what, overly permissive grants, and least-privilege fixes.`,
          `Vary wording. Cite SCAN_EVIDENCE_JSON only — do not invent principals or actions.`,
          ``,
          `SCAN_EVIDENCE_JSON:`,
          JSON.stringify(compactReport(report), null, 2),
          ``,
          `LOCAL_RANKING:`,
          analyzeLocally(report).offlineNarrative,
          ``,
          `Document excerpt (truncated):`,
          text.slice(0, 8000),
        ].join("\n"),
      },
    ];

    const reply = await streamSentinelChat({
      messages,
      temperature: 1.05,
      maxTokens: 4096,
      preferFallback: false,
    });

    return NextResponse.json({
      reply,
      markdown: reply,
      reportMarkdown,
      summary: report.summary,
      findings: report.findings,
      fixLogs,
      persist,
      model: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "pdf analysis failed" },
      { status: 500 },
    );
  }
}
