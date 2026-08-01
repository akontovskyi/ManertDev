/**
 * One-shot connectivity probe:
 *   npx tsx scripts/probe-supabase.ts
 *
 * Loads .env.local manually (no dotenv dependency).
 */
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

async function main() {
  const { probeSupabase, getSupabaseConfigStatus } = await import(
    "../src/lib/supabase"
  );

  console.log("Config:", getSupabaseConfigStatus());
  const result = await probeSupabase();
  console.log(result.ok ? "OK" : "FAIL", result.message);
  if (result.details) console.log(JSON.stringify(result.details, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
