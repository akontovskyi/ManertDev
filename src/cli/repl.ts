/**
 * Interactive real-time AI REPL for SentinelDev.
 * Every message streams through NVIDIA Nemotron (OpenAI-compatible).
 * Local scanners run only for security questions — they feed evidence, AI speaks.
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
  formatCommandExamples,
} from "../lib/cli-theme";
import { reportToFixLogs } from "../lib/report";
import { persistFixLogs } from "../lib/supabase";
import {
  SENTINEL_SYSTEM_PROMPT,
  getNvidiaConfig,
  streamSentinelChat,
  isSecurityQuestion,
} from "../lib/nvidia";
import { analyzeLocally } from "../lib/local-analyst";
import { editorLabel } from "../lib/editor";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { SentinelReport } from "../lib/types";

export async function startRepl(opts?: { root?: string }): Promise<void> {
  let root = path.resolve(
    opts?.root || process.env.SENTINEL_SCAN_ROOT || process.cwd(),
  );
  // Prefer any available key (fallback counts) so general chat works
  const cfg = getNvidiaConfig({ preferFallback: true }) || getNvidiaConfig();
  let aiEnabled = Boolean(cfg);
  let showThinking = false;

  console.log("");
  console.log(
    bannerPublic("Welcome to SentinelDev — real-time AI in your terminal"),
  );
  console.log("");
  console.log(asciiLogoPublic());
  console.log("");
  console.log(
    c.white("Ask anything. Live model chat with automatic key/model fallbacks."),
  );
  console.log(
    c.dim(
      "No security keywords → fallback model key first. Security asks → primary model + local scan.",
    ),
  );
  console.log(c.dim("Propose-only on code — I never auto-modify files."));
  console.log("");
  console.log(c.muted(`cwd:     ${root}`));
  console.log(c.muted(`editor:  ${editorLabel()}`));
  console.log(
    c.muted(
      aiEnabled
        ? `model:   LIVE · ${cfg!.model} · multi-fallback`
        : "model:   OFF — set model keys in ~/.sentineldev/.env",
    ),
  );
  console.log("");
  console.log(formatCommandExamples());
  console.log(
    c.violet(
      'Quick try: "hi" · "/scan" · "/ossprey" · "find exposed endpoints"',
    ),
  );
  console.log("");

  if (!aiEnabled) {
    console.log(
      c.yellow(
        "No model keys — chat limited. Add OPENROUTER_API_KEY / OPENROUTER_FALLBACK_API_KEY to ~/.sentineldev/.env then restart.",
      ),
    );
    console.log("");
  }

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
      console.log(c.dim("Bye. Stay curious."));
      rl.close();
      return;
    }

    if (line === "/help") {
      console.log("");
      console.log(formatCommandExamples());
      continue;
    }

    if (line.startsWith("/cd ")) {
      root = path.resolve(line.slice(4).trim() || ".");
      console.log(c.dim(`scan root → ${root}`));
      continue;
    }

    if (line.startsWith("/think")) {
      const arg = line.slice(6).trim().toLowerCase();
      if (arg === "on") showThinking = true;
      else if (arg === "off") showThinking = false;
      console.log(c.dim(`thinking stream: ${showThinking ? "ON" : "OFF"}`));
      continue;
    }

    if (line.startsWith("/ai") || line.startsWith("/model")) {
      const arg = line.replace(/^\/(ai|model)\s*/i, "").trim().toLowerCase();
      if (arg === "off") {
        aiEnabled = false;
        console.log(c.dim("Live model OFF."));
      } else if (arg === "on") {
        if (!getNvidiaConfig({ preferFallback: true }) && !getNvidiaConfig()) {
          console.log(
            c.yellow(
              "No model keys (OPENROUTER_API_KEY / OPENROUTER_FALLBACK_API_KEY).",
            ),
          );
        } else {
          aiEnabled = true;
          console.log(c.dim("Live model ON."));
        }
      } else {
        console.log(c.dim(`Live model is ${aiEnabled ? "ON" : "OFF"}`));
      }
      continue;
    }

    try {
      if (line.startsWith("/")) {
        await handleSlash(line, root, history, aiEnabled, showThinking);
        continue;
      }

      await handleChat(line, root, history, aiEnabled, showThinking);
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
  showThinking: boolean,
): Promise<void> {
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
    ossprey: "ossprey",
    osprey: "ossprey",
    supply: "ossprey",
  };

  const kind = map[cmd || ""];
  if (!kind) {
    console.log(
      c.dim("Unknown. Type /help for all commands and examples."),
    );
    return;
  }

  console.log(c.dim(`Local scan (${kind}) → ${scanRoot}`));
  let report: SentinelReport;
  try {
    report = await runScan({
      root: scanRoot,
      kind,
      query: wantsPatch(arg) ? "apply fix" : kind,
    });
  } catch (err) {
    console.log(
      c.yellow(
        `Scan failed — falling back to AI explanation only. (${err instanceof Error ? err.message : String(err)})`,
      ),
    );
    history.push({
      role: "user",
      content: `Forced ${kind} scan failed on ${scanRoot}. Explain what that scan usually looks for and how to retry.`,
    });
    if (aiEnabled) await streamAi(history, showThinking, false);
    return;
  }

  printLocalBrief(report);
  await persistQuiet(report);

  history.push({
    role: "user",
    content: [
      `I ran a ${kind} scan. Give a fresh, natural summary of what matters and what to fix first.`,
      `Vary your wording — do not sound like a template.`,
      `SCAN_EVIDENCE_JSON:`,
      JSON.stringify(compactReport(report), null, 2),
      `LOCAL_RANKING:`,
      analyzeLocally(report).offlineNarrative,
    ].join("\n"),
  });

  if (aiEnabled) {
    await streamAi(history, showThinking, false);
  } else {
    console.log(formatCliReport(report));
  }
}

async function handleChat(
  userText: string,
  root: string,
  history: ChatCompletionMessageParam[],
  aiEnabled: boolean,
  showThinking: boolean,
): Promise<void> {
  const security = isSecurityQuestion(userText);
  // No security keywords → use fallback OpenRouter key first
  const preferFallback = !security;
  let evidenceBlock = "";

  if (security) {
    try {
      const routed = routeQuery(userText);
      console.log(
        c.dim(`Security ask → local ${routed.kind} scan on ${root} ...`),
      );
      const report = await runScan({
        root,
        kind: routed.kind === "iam" ? "full" : routed.kind,
        query: userText,
      });
      printLocalBrief(report);
      await persistQuiet(report);
      evidenceBlock = [
        "",
        "SCAN_EVIDENCE_JSON (cite these if relevant; do not invent):",
        JSON.stringify(compactReport(report), null, 2),
      ].join("\n");
    } catch (err) {
      console.log(
        c.yellow(
          `Local scan failed — falling back to AI-only reply. (${err instanceof Error ? err.message : String(err)})`,
        ),
      );
    }
  } else {
    console.log(c.dim("General chat → live model (fallback key)"));
  }

  history.push({
    role: "user",
    content: [
      userText,
      "",
      `Context: cwd=${root} · time=${new Date().toISOString()} · nonce=${Math.random().toString(36).slice(2, 8)}`,
      preferFallback
        ? "Mode: general chat (fallback model key preferred)."
        : "Mode: security assist (primary model key preferred).",
      "Reply in a natural, unique way. Do not reuse prior phrasing.",
      evidenceBlock,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  if (!aiEnabled || !getNvidiaConfig({ preferFallback })) {
    if (security) {
      console.log(
        c.yellow(
          "Model offline — showing local ranking only. Set model keys in ~/.sentineldev/.env",
        ),
      );
    } else {
      console.log(
        c.yellow(
          "Model offline — add OPENROUTER_FALLBACK_API_KEY (or OPENROUTER_API_KEY) to ~/.sentineldev/.env",
        ),
      );
    }
    console.log("");
    return;
  }

  console.log(c.smartBlue("SentinelDev · live model"));
  console.log("");
  await streamAi(history, showThinking, preferFallback);
}

function printLocalBrief(report: SentinelReport): void {
  const a = analyzeLocally(report);
  console.log("");
  console.log(
    c.muted(
      `local engine · ${a.riskLabel} · score ${a.riskScore}/100 · ${report.findings.length} finding(s)`,
    ),
  );
  for (const f of a.priorityQueue.slice(0, 5)) {
    const loc = f.evidence.line
      ? `${f.evidence.file}:${f.evidence.line}`
      : f.evidence.file;
    console.log(c.redSoft(`  [${f.severity}] ${loc} — ${f.title}`));
  }
  if (report.findings.length > 5) {
    console.log(c.dim(`  … +${report.findings.length - 5} more`));
  }
  console.log("");
}

async function streamAi(
  history: ChatCompletionMessageParam[],
  showThinking: boolean,
  preferFallback = false,
): Promise<void> {
  let sawReasoning = false;
  try {
    const content = await streamSentinelChat({
      messages: history,
      temperature: 1.05,
      maxTokens: 4096,
      showThinking,
      preferFallback,
      onFallback: (from, to, reason) => {
        console.log(c.dim(`fallback: ${from} → ${to} (${reason.slice(0, 80)})`));
      },
      handlers: {
        onReasoning: (t) => {
          if (!showThinking) return;
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
    history.push({ role: "assistant", content: content || "(empty)" });
  } catch (err) {
    console.log(
      c.red(
        `Model failed after all fallbacks: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
    console.log(
      c.dim(
        "Local tools still work: /scan /endpoints /env /db /ossprey  ·  check model keys in ~/.sentineldev/.env",
      ),
    );
    console.log("");
    return;
  }

  if (history.length > 30) {
    history.splice(1, history.length - 25);
  }
}

function compactReport(report: SentinelReport) {
  return {
    summary: report.summary,
    scanKind: report.scanKind,
    targetPath: report.targetPath,
    findings: report.findings.slice(0, 20).map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      description: f.description,
      file: f.evidence.file,
      line: f.evidence.line,
      snippet: f.evidence.snippet,
      remediation: f.remediation,
    })),
  };
}

async function persistQuiet(report: SentinelReport) {
  try {
    const rows = reportToFixLogs(report);
    const persist = await persistFixLogs(rows);
    if (persist.ok) {
      console.log(c.green(`Supabase: stored ${persist.count} fix_log row(s).`));
    } else if (persist.error && !persist.error.includes("not configured")) {
      console.log(c.dim(`Supabase (non-fatal): ${persist.error}`));
    }
  } catch (err) {
    console.log(
      c.dim(
        `Supabase persist skipped: ${err instanceof Error ? err.message : String(err)}`,
      ),
    );
  }
}
