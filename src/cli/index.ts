#!/usr/bin/env node
/**
 * SentinelDev CLI
 *
 *   npx tsx src/cli/index.ts scan
 *   npx tsx src/cli/index.ts scan --kind secrets
 *   npx tsx src/cli/index.ts ask "are there exposed endpoints?"
 *   npx tsx src/cli/index.ts ask "scramble my keys" --root ../my-app
 */

import path from "node:path";
import { runScan, kindFromString } from "../scanners";
import { routeQuery, wantsPatch, buildModalTaskDescription } from "../lib/router";
import { formatCliHelp, formatCliReport, c } from "../lib/cli-theme";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const cmd = args[0] || "help";
  let root = process.env.SENTINEL_SCAN_ROOT || process.cwd();
  let kind = "full";
  let query = "";
  let plain = false;

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === "--root" && args[i + 1]) {
      root = path.resolve(args[++i]);
    } else if (a === "--kind" && args[i + 1]) {
      kind = args[++i];
    } else if (a === "--plain" || a === "--no-color") {
      plain = true;
    } else if (!a.startsWith("--")) {
      query = query ? `${query} ${a}` : a;
    }
  }

  query = query.replace(/^["']|["']$/g, "");
  return { cmd, root, kind, query, plain };
}

async function main() {
  const { cmd, root, kind, query, plain } = parseArgs(process.argv);
  if (plain) process.env.NO_COLOR = "1";

  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(formatCliHelp());
    return;
  }

  if (cmd === "modal") {
    const routed = routeQuery(query || "full scan");
    const task = buildModalTaskDescription({
      root,
      kind: routed.kind,
      query: query || routed.label,
    });
    console.log("");
    console.log(c.peach("╭──────────────────────────────────────────╮"));
    console.log(c.peach("│ * Modal task description (copy / POST)   │"));
    console.log(c.peach("╰──────────────────────────────────────────╯"));
    console.log("");
    console.log(c.dim(task));
    console.log("");
    return;
  }

  if (cmd === "scan" || cmd === "ask") {
    const routed =
      cmd === "ask"
        ? routeQuery(query || "full")
        : { kind: kindFromString(kind), label: kind };
    const effectiveQuery =
      cmd === "ask"
        ? query
        : wantsPatch(query)
          ? query
          : query || routed.kind;

    const report = await runScan({
      root,
      kind: routed.kind,
      query: effectiveQuery,
    });

    console.log(formatCliReport(report));
    return;
  }

  console.log(formatCliHelp());
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(c.red("SentinelDev error:"), err);
  process.exitCode = 1;
});
