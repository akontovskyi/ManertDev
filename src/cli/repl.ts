/**
 * Interactive Claude-style REPL for SentinelDev.
 *
 * Architecture (NOT an API wrapper):
 *   1. Local scanners in src/scanners/* find issues (filesystem, regex, heuristics)
 *   2. Local analyst ranks / narrates offline (src/lib/local-analyst.ts)
 *   3. NVIDIA Nemotron is OPTIONAL — narration only, grounded in local evidence
 */

import readline from "node:readline";
import path from "node:path";
import { routeQuery, wantsPatch } from "../lib/router";
import { runScan } from "../scanners";
import {
  formatCliReport,
  c,
  asciiLogoPublic,
  bannerPublic,
} from "../lib/cli-theme";
import { reportToFixLogs } from "../lib/report";
import { persistFixLogs } from "../lib/supabase";
import {
  SENTINEL_SYSTEM_PROMPT,
  getNvidiaConfig,
  streamSentinelChat,
} from "../lib/nvidia";
import { analyzeLocally } from "../lib/local-analyst";
import { editorLabel } from "../lib/editor";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { SentinelReport } from "../lib/types";

export async function startRepl(opts?: { root?: string }): Promise<void> {
  let root = path.resolve(
    opts?.root || process.env.SENTINEL_SCAN_ROOT || process.cwd(),
  );
  const cfg = getNvidiaConfig();
  let aiEnabled = Boolean(cfg);
  let lastReport: SentinelReport | null = null;

  console.log("");
  console.log(
    bannerPublic("Welcome to SentinelDev — local security engine + optional AI"),
  );
  console.log("");
  console.log(asciiLogoPublic());
  console.log("");
  console.log(
    c.white("This is NOT an API wrapper."),
  );
  console.log(
    c.dim(
      "Core: local scanners (endpoints/secrets/entrances/database) + local risk ranking.",
    ),
  );
  console.log(
    c.dim(
      "Optional: Nemotron only narrates after local evidence exists. Scans work offline.",
    ),
  );
  console.log(c.dim("Propose-only — never auto-modifies files."));
  console.log("");
  console.log(c.muted(`cwd:     ${root}`));
  console.log(c.muted(`editor:  ${editorLabel()}`));
  console.log(
    c.muted(
      aiEnabled
        ? `ai:      optional · ${cfg!.model}`
        : "ai:      off (local engine only — set NVIDIA_API_KEY to enable narration)",
    ),
  );
  console.log("");
  console.log(c.white("Commands:"));
  console.log(c.dim("  /scan [path]     local full sweep + ranked report"));
  console.log(c.dim("  /endpoints       local endpoint scan"));
  console.log(c.dim("  /env             local secrets/env scan"));
  console.log(c.dim("  /db              local database scan"));
  console.log(c.dim("  /ai on|off       toggle optional AI narration"));
  console.log(c.dim("  /cd <path>       change scan root"));
  console.log(c.dim("  /help            show help"));
  console.log(c.dim("  /exit            quit"));
  console.log("");
  console.log(
    c.violet(
      'Ask anything — e.g. "find exposed endpoints" (local first, AI optional)',
    ),
  );
  console.log("");

  const history: ChatCompletionMessageParam[] = [
    { role: "system", content: SENTINEL_SYSTEM_PROMPT },
  ];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const ask = (prompt: string) =>
    new Promise<string>((resolve) => rl.question(prompt, resolve));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const line = (await ask(c.smartBlue("sentinel> "))).trim();
    if (!line) continue;

    if (
      line === "/exit" ||
      line === "/quit" ||
      line === "exit" ||
      line === "quit"
    ) {
      console.log(c.dim("Bye. Stay secure."));
      rl.close();
      return;
    }

    if (line === "/help") {
      console.log(
        c.dim(
          "Local engine answers first. AI narration is optional. /scan /endpoints /env /db /ai on|off /cd /exit",
        ),
      );
      continue;
    }

    if (line.startsWith("/cd ")) {
      root = path.resolve(line.slice(4).trim() || ".");
      console.log(c.dim(`scan root → ${root}`));
      continue;
    }

    if (line.startsWith("/ai")) {
      const arg = line.slice(3).trim().toLowerCase();
      if (arg === "off") {
        aiEnabled = false;
        console.log(c.dim("AI narration OFF — local engine only."));
      } else if (arg === "on") {
        if (!getNvidiaConfig()) {
          console.log(
            c.yellow("Cannot enable AI — NVIDIA_API_KEY not configured."),
          );
        } else {
          aiEnabled = true;
          console.log(c.dim("AI narration ON — still grounded in local evidence only."));
        }
      } else {
        console.log(c.dim(`AI narration is ${aiEnabled ? "ON" : "OFF"}`));
      }
      continue;
    }

    try {
      if (line.startsWith("/")) {
        lastReport = await handleSlash(line, root, history, aiEnabled);
        continue;
      }

      lastReport = await handleChat(line, root, history, aiEnabled);
    } catch (err) {
      console.log(
        c.red(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }
}

async function handleSlash(
  line: string,
  root: string,
  history: ChatCompletionMessageParam[],
  aiEnabled: boolean,
): Promise<SentinelReport | null> {
  const [cmd, ...rest] = line.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  const scanRoot = arg && !arg.startsWith("-") ? path.resolve(root, arg) : root;

  const map: Record<string, Parameters<typeof runScan>[0]["kind"]> = {
    scan: "full",
    endpoints: "endpoints",
    endpoint: "endpoints",
    env: "secrets",
    keys: "secrets",
    secrets: "secrets",
    db: "database",
    database: "database",
    admin: "entrances",
    scramble: "scramble",
  };

  const kind = map[cmd || ""];
  if (!kind) {
    console.log(
      c.dim(
        "Unknown command. Try /scan /endpoints /env /db /ai on|off /cd /help /exit",
      ),
    );
    return null;
  }

  console.log(c.dim(`Local scan (${kind}) → ${scanRoot}`));
  const report = await runScan({
    root: scanRoot,
    kind,
    query: wantsPatch(arg) ? "apply fix" : kind,
  });

  printLocalEngine(report);
  console.log(formatCliReport(report));
  await persistQuiet(report);

  history.push({
    role: "user",
    content: `Local ${kind} scan complete. Narrate only from this evidence:\n${JSON.stringify(compactReport(report), null, 2)}`,
  });

  if (aiEnabled) {
    await streamAi(history);
  } else {
    console.log(
      c.dim("AI narration skipped (/ai on to enable). Local report above is complete."),
    );
    console.log("");
  }

  return report;
}

async function handleChat(
  userText: string,
  root: string,
  history: ChatCompletionMessageParam[],
  aiEnabled: boolean,
): Promise<SentinelReport> {
  const routed = routeQuery(userText);
  console.log(
    c.dim(`Local router → ${routed.label} (${routed.kind}) on ${root}`),
  );
  console.log(c.dim("Running local scanners (no cloud required)..."));

  const report = await runScan({
    root,
    kind: routed.kind === "iam" ? "full" : routed.kind,
    query: userText,
  });

  // PRIMARY answer = local engine
  printLocalEngine(report);
  await persistQuiet(report);

  history.push({
    role: "user",
    content: [
      `User request: ${userText}`,
      `IMPORTANT: Local scanners already produced the findings below.`,
      `You are OPTIONAL narration. Do not invent new findings.`,
      `Cite only file:line from SCAN_EVIDENCE_JSON.`,
      "",
      "LOCAL_ANALYST:",
      analyzeLocally(report).offlineNarrative,
      "",
      "SCAN_EVIDENCE_JSON:",
      JSON.stringify(compactReport(report), null, 2),
    ].join("\n"),
  });

  if (aiEnabled && getNvidiaConfig()) {
    console.log(
      c.smartBlue("Optional AI narration (Nemotron) — grounded in local evidence"),
    );
    console.log("");
    await streamAi(history);
  } else {
    console.log(
      c.dim(
        "Done. Answer above is from the local engine. Enable AI with /ai on if you want narration.",
      ),
    );
    console.log("");
  }

  return report;
}

function printLocalEngine(report: SentinelReport): void {
  const analysis = analyzeLocally(report);
  console.log("");
  console.log(c.smartBlue("── Local engine (no API) ──"));
  console.log("");
  console.log(c.white(analysis.headline));
  console.log(
    c.muted(
      `risk: ${analysis.riskLabel} · score ${analysis.riskScore}/100 · findings ${report.findings.length}`,
    ),
  );
  console.log("");

  if (analysis.priorityQueue.length === 0) {
    console.log(c.dim(analysis.offlineNarrative));
    console.log("");
    return;
  }

  console.log(c.red("Priority queue"));
  analysis.priorityQueue.forEach((f, i) => {
    const loc = f.evidence.line
      ? `${f.evidence.file}:${f.evidence.line}`
      : f.evidence.file;
    console.log(c.red(`${i + 1}. [${f.severity}] ${f.title}`));
    console.log(c.dim(`   id:    ${f.id}`));
    console.log(c.redSoft(`   where: ${loc}`));
    console.log(c.dim(`   why:   ${f.description}`));
    console.log(c.green(`   fix:   ${f.remediation}`));
  });
  console.log("");
  console.log(c.white("Next actions"));
  analysis.actions.forEach((a, i) => console.log(c.dim(`  ${i + 1}. ${a}`)));
  console.log("");
}

async function streamAi(history: ChatCompletionMessageParam[]): Promise<void> {
  if (!getNvidiaConfig()) {
    console.log(c.yellow("NVIDIA_API_KEY missing — local engine result stands alone."));
    return;
  }

  let sawReasoning = false;
  const content = await streamSentinelChat({
    messages: history,
    handlers: {
      onReasoning: (t) => {
        if (!sawReasoning) {
          process.stdout.write(c.muted("[thinking] "));
          sawReasoning = true;
        }
        process.stdout.write(c.muted(t));
      },
      onContent: (t) => {
        if (sawReasoning) {
          process.stdout.write("\n\n");
          sawReasoning = false;
        }
        process.stdout.write(t);
      },
    },
  });

  process.stdout.write("\n\n");
  history.push({ role: "assistant", content: content || "(empty response)" });

  if (history.length > 24) {
    history.splice(1, history.length - 21);
  }
}

function compactReport(report: SentinelReport) {
  return {
    summary: report.summary,
    scanKind: report.scanKind,
    targetPath: report.targetPath,
    scannedAt: report.scannedAt,
    findings: report.findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      description: f.description,
      file: f.evidence.file,
      line: f.evidence.line,
      snippet: f.evidence.snippet,
      remediation: f.remediation,
      proposedPatch: f.proposedPatch,
    })),
  };
}

async function persistQuiet(report: SentinelReport) {
  const rows = reportToFixLogs(report);
  const persist = await persistFixLogs(rows);
  if (persist.ok) {
    console.log(c.green(`Supabase: stored ${persist.count} fix_log row(s).`));
  } else if (persist.error && !persist.error.includes("not configured")) {
    console.log(c.dim(`Supabase: ${persist.error}`));
  }
}
