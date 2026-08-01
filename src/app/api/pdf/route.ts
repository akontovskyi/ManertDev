import { NextRequest, NextResponse } from "next/server";
import { formatReportMarkdown, reportToFixLogs } from "@/lib/report";
import { persistFixLogs } from "@/lib/supabase";
import { runIamAnalysis } from "@/scanners";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
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

    return NextResponse.json({
      summary: report.summary,
      findings: report.findings,
      markdown: formatReportMarkdown(report),
      fixLogs,
      persist,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "pdf analysis failed" },
      { status: 500 },
    );
  }
}
