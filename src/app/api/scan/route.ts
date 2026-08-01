import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import { formatReportMarkdown, reportToFixLogs } from "@/lib/report";
import { persistFixLogs } from "@/lib/supabase";
import { kindFromString, runScan } from "@/scanners";
import { buildModalTaskDescription } from "@/lib/router";

export const runtime = "nodejs";

function resolveScanRoot(rootInput: string): string {
  if (path.isAbsolute(rootInput)) return path.normalize(rootInput);
  return path.resolve(process.cwd(), rootInput || ".");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const kind = kindFromString(body.kind);
    const rootInput = String(body.root || process.env.SENTINEL_SCAN_ROOT || ".");
    const root = resolveScanRoot(rootInput);
    const query = String(body.query || kind);

    const report = await runScan({ root, kind, query });
    const fixLogs = reportToFixLogs(report);
    const persist = await persistFixLogs(fixLogs);

    return NextResponse.json({
      report,
      markdown: formatReportMarkdown(report),
      fixLogs,
      persist,
      modalTask: buildModalTaskDescription({ root, kind, query }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "scan failed" },
      { status: 500 },
    );
  }
}
