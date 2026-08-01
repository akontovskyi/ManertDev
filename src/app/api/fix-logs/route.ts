import { NextResponse } from "next/server";
import {
  getSupabaseConfigStatus,
  listFixLogs,
  probeSupabase,
} from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  const logs = await listFixLogs(100);
  const status = getSupabaseConfigStatus();
  const probe = await probeSupabase();
  return NextResponse.json({
    configured: status.configured,
    status,
    probe,
    logs,
  });
}
