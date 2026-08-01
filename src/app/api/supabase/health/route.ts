import { NextResponse } from "next/server";
import { getSupabaseConfigStatus, probeSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  const status = getSupabaseConfigStatus();
  const probe = await probeSupabase();
  return NextResponse.json({ status, probe });
}
