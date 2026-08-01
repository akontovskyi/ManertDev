import type { Finding } from "@/lib/types";
import {
  collectSourceFiles,
  makeId,
  snippetAround,
} from "./filesystem";

const DB_ROUTE =
  /\/(db|database|sql|query|mongo|graphql|supabase|prisma)(\/|"|'|`|\?|$)/i;

const RAW_QUERY =
  /\b(query|execute|raw|rawQuery|\$queryRaw|sequelize\.query|mongoose\.connect)\s*\(/gi;

const SQL_INJECT_HINT =
  /[`'"].*\+\s*(req\.|request\.|params\.|query\.|body\.|userInput)/i;

const OPEN_DB_PORT =
  /\b(5432|3306|27017|6379|1433|8529)\b/;

export async function scanDatabase(root: string): Promise<Finding[]> {
  const files = await collectSourceFiles(root);
  const findings: Finding[] = [];

  for (const file of files) {
    file.lines.forEach((line, idx) => {
      const lineNo = idx + 1;

      if (
        DB_ROUTE.test(line) &&
        /\b(get|post|put|patch|delete|route|router|app)\b/i.test(line)
      ) {
        findings.push({
          id: makeId("dbroute", file.relativePath, lineNo),
          severity: "High",
          category: "database",
          title: "Possible database-facing HTTP route",
          description:
            "A route path looks database-related. If reachable without auth, this is a critical exposure risk.",
          evidence: {
            file: file.relativePath,
            line: lineNo,
            snippet: snippetAround(file.lines, idx),
          },
          remediation:
            "Never expose raw DB operations over public HTTP. Use authenticated server actions / services with parameterized queries.",
        });
      }

      RAW_QUERY.lastIndex = 0;
      if (RAW_QUERY.test(line)) {
        const inject =
          SQL_INJECT_HINT.test(line) ||
          SQL_INJECT_HINT.test(
            file.lines.slice(Math.max(0, idx - 2), idx + 3).join("\n"),
          );
        findings.push({
          id: makeId("dbq", file.relativePath, lineNo),
          severity: inject ? "Critical" : "Medium",
          category: "database",
          title: inject
            ? "Possible SQL/NoSQL injection sink"
            : "Raw database query usage",
          description: inject
            ? "User-controlled input appears concatenated into a query."
            : "Raw query API detected — verify parameterization and access control.",
          evidence: {
            file: file.relativePath,
            line: lineNo,
            snippet: snippetAround(file.lines, idx),
          },
          remediation:
            "Use parameterized queries / ORM bind variables. Validate and authorize every caller. Prefer least-privilege DB roles.",
          proposedPatch: inject
            ? [
                `--- a/${file.relativePath}`,
                `+++ b/${file.relativePath}`,
                `@@`,
                `-// unsafe string concat into query`,
                `+// use bound parameters, e.g.:`,
                `+// await db.query('SELECT * FROM users WHERE id = $1', [userId]);`,
              ].join("\n")
            : undefined,
        });
      }

      if (
        OPEN_DB_PORT.test(line) &&
        /(host|port|url|listen|0\.0\.0\.0|expose)/i.test(line)
      ) {
        findings.push({
          id: makeId("dbport", file.relativePath, lineNo),
          severity: "High",
          category: "database",
          title: "Database port referenced in config",
          description:
            "Common DB port found alongside host/expose settings. Ensure the DB is not publicly reachable.",
          evidence: {
            file: file.relativePath,
            line: lineNo,
            snippet: snippetAround(file.lines, idx),
          },
          remediation:
            "Bind DB to private network only. Require TLS + auth. Do not publish 5432/3306/27017/6379 to the internet.",
        });
      }
    });
  }

  return dedupe(findings);
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.evidence.file}:${f.evidence.line}:${f.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
