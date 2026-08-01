import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { routeQuery } from "@/lib/router";
import { formatReportMarkdown, reportToFixLogs } from "@/lib/report";
import { persistFixLogs } from "@/lib/supabase";
import { runScan } from "@/scanners";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query = String(body.query || "").trim();
    const rootInput = String(body.root || process.env.SENTINEL_SCAN_ROOT || ".");
    const root = path.resolve(process.cwd(), rootInput);

    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }

    const routed = routeQuery(query);
    const report = await runScan({
      root,
      kind: routed.kind,
      query,
    });

    const fixLogs = reportToFixLogs(report);
    const persist = await persistFixLogs(fixLogs);

    return NextResponse.json({
      routed,
      summary: report.summary,
      findings: report.findings,
      markdown: formatReportMarkdown(report),
      fixLogs,
      persist,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "chat failed" },
      { status: 500 },
    );
  }
}
