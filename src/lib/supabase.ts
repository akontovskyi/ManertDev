import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FixLogRow } from "./types";

let client: SupabaseClient | null = null;

function resolveSupabaseKey(): string | undefined {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = resolveSupabaseKey();

  if (!url || !key || url.includes("YOUR_PROJECT")) {
    return null;
  }

  if (!client) {
    client = createClient(url, key);
  }
  return client;
}

export function getSupabaseConfigStatus(): {
  configured: boolean;
  url?: string;
  projectRef?: string;
  keyType?: "service_role" | "publishable" | "anon";
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !resolveSupabaseKey() || url.includes("YOUR_PROJECT")) {
    return { configured: false };
  }

  let keyType: "service_role" | "publishable" | "anon" = "anon";
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) keyType = "service_role";
  else if (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    resolveSupabaseKey()?.startsWith("sb_publishable_")
  ) {
    keyType = "publishable";
  }

  const projectRef = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  return { configured: true, url, projectRef, keyType };
}

export async function persistFixLogs(
  rows: FixLogRow[],
): Promise<{ ok: boolean; error?: string; count: number }> {
  const sb = getSupabase();
  if (!sb) {
    return {
      ok: false,
      error: "Supabase not configured — logs returned in response only.",
      count: 0,
    };
  }

  if (!rows.length) return { ok: true, count: 0 };

  const { error } = await sb.from("fix_logs").insert(rows);
  if (error) {
    return { ok: false, error: error.message, count: 0 };
  }
  return { ok: true, count: rows.length };
}

/** Manually insert one security issue row. */
export async function insertFixLog(
  row: FixLogRow,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase not configured" };

  const { data, error } = await sb.from("fix_logs").insert(row).select("id").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id as string };
}

/** Mark an issue fixed by id (uuid or finding_id in metadata). */
export async function markFixLogFixed(
  idOrFindingId: string,
): Promise<{ ok: boolean; error?: string; count: number }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase not configured", count: 0 };

  const now = new Date().toISOString();
  const byId = await sb
    .from("fix_logs")
    .update({ fixed: true, status: "fixed", fixed_at: now })
    .eq("id", idOrFindingId)
    .select("id");

  if (!byId.error && byId.data && byId.data.length > 0) {
    return { ok: true, count: byId.data.length };
  }

  // Fallback: match metadata->>finding_id
  const { data, error } = await sb
    .from("fix_logs")
    .update({ fixed: true, status: "fixed", fixed_at: now })
    .filter("metadata->>finding_id", "eq", idOrFindingId)
    .select("id");

  if (error) return { ok: false, error: error.message, count: 0 };
  return { ok: true, count: data?.length || 0 };
}

export async function listFixLogs(limit = 50): Promise<FixLogRow[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from("fix_logs")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as FixLogRow[];
}

/** Smoke-test connectivity and fix_logs table presence. */
export async function probeSupabase(): Promise<{
  ok: boolean;
  message: string;
  details?: unknown;
}> {
  const status = getSupabaseConfigStatus();
  if (!status.configured) {
    return { ok: false, message: "Supabase env vars are not configured." };
  }

  const sb = getSupabase();
  if (!sb) {
    return { ok: false, message: "Failed to create Supabase client." };
  }

  const { error } = await sb.from("fix_logs").select("id").limit(1);
  if (error) {
    const needsMigration =
      error.message.includes("Could not find the table") ||
      error.code === "PGRST205" ||
      error.message.includes("schema cache") ||
      error.message.includes("does not exist");

    return {
      ok: false,
      message: error.message,
      details: {
        hint: needsMigration
          ? "Run supabase/migrations/001_fix_logs.sql in the Supabase SQL Editor."
          : undefined,
        code: error.code,
        projectRef: status.projectRef,
        keyType: status.keyType,
      },
    };
  }

  return {
    ok: true,
    message: `Connected to ManertDev (${status.projectRef}) using ${status.keyType} key.`,
    details: status,
  };
}
