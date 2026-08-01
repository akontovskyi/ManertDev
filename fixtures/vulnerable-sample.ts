/**
 * Fixture app with intentional weaknesses for local ManertDev demos.
 * DO NOT deploy. Propose-only scanners should flag these patterns.
 */

// Sensitive admin route without auth hint
const adminMount = "app.get('/admin/users', handler)";

export async function GET() {
  return Response.json({ ok: true, mount: adminMount });
}

export const debugEndpoint = "/debug/config";
export const API_KEY = "sk-demoEXAMPLEKEYDONOTUSEINPROD12345";

export function dangerousQuery(userInput: string) {
  const q = "SELECT * FROM users WHERE name = '" + userInput + "'";
  return q;
}

export const corsConfig = { origin: "*" };
export const PORT = 3000;
export const dbUrl = "postgres://app:secret@0.0.0.0:5432/app";
