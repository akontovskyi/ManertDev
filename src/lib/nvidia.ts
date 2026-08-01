/**
 * OpenAI-compatible LLM client with multi-key / multi-model fallbacks.
 * Primary + fallback OpenRouter keys; local scanners remain separate.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export interface NvidiaConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  provider: "openrouter" | "nvidia" | "openai";
  label: string;
}

const FREE_MODELS = [
  process.env.OPENROUTER_MODEL,
  process.env.OPENROUTER_FALLBACK_MODEL,
  process.env.OPENAI_MODEL,
  "openrouter/free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-27b-it:free",
  "qwen/qwen-2.5-7b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

function openRouterBase(): string {
  return (
    process.env.OPENROUTER_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://openrouter.ai/api/v1"
  );
}

function primaryOpenRouterKey(): string | undefined {
  return (
    process.env.OPENROUTER_API_KEY ||
    (process.env.OPENAI_API_KEY?.startsWith("sk-or-")
      ? process.env.OPENAI_API_KEY
      : undefined)
  );
}

function fallbackOpenRouterKey(): string | undefined {
  return (
    process.env.OPENROUTER_FALLBACK_API_KEY ||
    process.env.OPENROUTER_API_KEY_FALLBACK ||
    process.env.OPENAI_FALLBACK_API_KEY
  );
}

/**
 * Build ordered LLM configs to try.
 * - General chat (no security keywords): prefer FALLBACK key first
 * - Security / keyword path: prefer PRIMARY key first
 * - Always append the other key + model variants as backups
 */
export function getLlmConfigChain(opts?: {
  preferFallback?: boolean;
}): NvidiaConfig[] {
  const chain: NvidiaConfig[] = [];
  const seen = new Set<string>();

  const push = (cfg: NvidiaConfig) => {
    const id = `${cfg.provider}|${cfg.apiKey.slice(0, 16)}|${cfg.model}`;
    if (seen.has(id)) return;
    seen.add(id);
    chain.push(cfg);
  };

  const primary = primaryOpenRouterKey();
  const fallback = fallbackOpenRouterKey();
  const base = openRouterBase();

  const keys: Array<{ key: string; label: string }> = [];
  if (opts?.preferFallback) {
    if (fallback) keys.push({ key: fallback, label: "openrouter-fallback" });
    if (primary) keys.push({ key: primary, label: "openrouter-primary" });
  } else {
    if (primary) keys.push({ key: primary, label: "openrouter-primary" });
    if (fallback) keys.push({ key: fallback, label: "openrouter-fallback" });
  }

  for (const { key, label } of keys) {
    for (const model of FREE_MODELS) {
      push({
        apiKey: key,
        baseURL: base,
        model,
        provider: "openrouter",
        label: `${label}:${model}`,
      });
    }
  }

  // NVIDIA fallback if configured
  const nv = process.env.NVIDIA_API_KEY || process.env.NVAPI_KEY;
  if (nv) {
    push({
      apiKey: nv,
      baseURL:
        process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
      model: process.env.NVIDIA_MODEL || "nvidia/nemotron-3-ultra-550b-a55b",
      provider: "nvidia",
      label: "nvidia-primary",
    });
  }

  // Generic OpenAI-compatible last resort
  const oa = process.env.OPENAI_API_KEY;
  if (oa && !oa.startsWith("sk-or-") && !oa.startsWith("nvapi-")) {
    push({
      apiKey: oa,
      baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      provider: "openai",
      label: "openai-primary",
    });
  }

  return chain;
}

/** First available config (backward compatible). */
export function getNvidiaConfig(opts?: {
  preferFallback?: boolean;
}): NvidiaConfig | null {
  return getLlmConfigChain(opts)[0] || null;
}

export function createNvidiaClient(cfg?: NvidiaConfig): OpenAI | null {
  const config = cfg || getNvidiaConfig();
  if (!config) return null;

  const headers: Record<string, string> = {};
  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] =
      process.env.OPENROUTER_SITE_URL ||
      "https://github.com/alvi83252-dot/SentinelDev";
    headers["X-Title"] = process.env.OPENROUTER_APP_NAME || "SentinelDev";
  }

  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultHeaders: headers,
  });
}

export const SENTINEL_SYSTEM_PROMPT = `You are SentinelDev — a real-time terminal AI with a cybersecurity specialty.

Personality:
- Talk like a sharp security engineer in a CLI.
- Answer ANY question, but when the topic is security/code/risks, be PRECISE and specific.
- Vary wording each reply. Plain text only. No markdown tables/HTML.

When answering cybersecurity / scan questions, ALWAYS structure like this:

1) Threat summary (1-2 sentences, specific — name the weakness)
2) Problem type (one of: exposed_endpoint | secret_leak | weak_auth | debug_exposure | database_exposure | injection | overly_permissive_iam | supply_chain_malware | misconfiguration)
3) Severity + why (Critical/High/Medium/Low) with blast radius
4) Exact location (file:line from SCAN_EVIDENCE_JSON only — never invent)
5) Exploit scenario (how an attacker could abuse it in practice)
6) Concrete fix steps (numbered, actionable, least-privilege)
7) Verify (how to confirm the fix worked)

Rules:
- If SCAN_EVIDENCE_JSON is present: local scanners found the issues — do not invent new ones.
- If no evidence: say so clearly; suggest which sentinel scan to run.
- Never claim you modified files. Propose only.
- For dumb/non-security chat: answer naturally without forcing a security lecture.
`;

export type StreamHandlers = {
  onReasoning?: (text: string) => void;
  onContent?: (text: string) => void;
};

function wrapConnectionError(err: unknown): Error {
  const anyErr = err as {
    message?: string;
    cause?: { message?: string; code?: string };
  };
  const msg = String(anyErr?.message || err);
  const cause = String(anyErr?.cause?.message || anyErr?.cause || "");
  const blob = `${msg} ${cause}`.toLowerCase();

  if (
    blob.includes("certificate") ||
    blob.includes("ssl") ||
    blob.includes("tls") ||
    blob.includes("connection error") ||
    blob.includes("fetch failed")
  ) {
    return new Error(
      [
        "LLM API connection failed (TLS/certificate).",
        "Fix: restart sentinel (uses --use-system-ca).",
        cause ? `Detail: ${cause}` : `Detail: ${msg}`,
      ].join("\n"),
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function streamOnce(
  cfg: NvidiaConfig,
  opts: {
    messages: ChatCompletionMessageParam[];
    handlers?: StreamHandlers;
    temperature: number;
    maxTokens: number;
    showThinking: boolean;
  },
): Promise<string> {
  const client = createNvidiaClient(cfg);
  if (!client) throw new Error("Failed to create LLM client");

  let stream;
  try {
    stream = await client.chat.completions.create({
      model: cfg.model,
      messages: opts.messages,
      temperature: opts.temperature,
      top_p: 0.92,
      max_tokens: opts.maxTokens,
      stream: true,
      ...({
        chat_template_kwargs: {
          enable_thinking: opts.showThinking,
        },
        reasoning_budget: opts.showThinking ? 4096 : 512,
      } as object),
    });
  } catch (err) {
    throw wrapConnectionError(err);
  }

  let full = "";
  let pending = "";
  let suppressingThink = false;

  for await (const chunk of stream) {
    if (!chunk.choices?.length) continue;
    const delta = chunk.choices[0].delta as {
      content?: string | null;
      reasoning_content?: string | null;
    };
    const reasoning = delta?.reasoning_content;
    if (reasoning) opts.handlers?.onReasoning?.(reasoning);

    const piece = delta?.content;
    if (!piece) continue;
    pending += piece;

    while (pending.length) {
      if (suppressingThink) {
        const end = pending.search(/<\/think>|<\/redacted_thinking>/i);
        if (end < 0) {
          pending = "";
          break;
        }
        pending = pending
          .slice(end)
          .replace(/^<\/think>|<\/redacted_thinking>/i, "");
        suppressingThink = false;
        continue;
      }

      const start = pending.search(/<think\b[^>]*>/i);
      const closeOnly = pending.search(/<\/think>|<\/redacted_thinking>/i);

      if (start >= 0 && (closeOnly < 0 || start <= closeOnly)) {
        const visible = pending.slice(0, start);
        if (visible) {
          full += visible;
          opts.handlers?.onContent?.(visible);
        }
        pending = pending.slice(start).replace(/^<think\b[^>]*>/i, "");
        suppressingThink = true;
        continue;
      }

      if (closeOnly >= 0) {
        pending = pending
          .slice(closeOnly)
          .replace(/^<\/think>|<\/redacted_thinking>/i, "");
        continue;
      }

      const partial = pending.match(/<[a-z/]*$/i);
      if (partial && partial.index != null) {
        const visible = pending.slice(0, partial.index);
        if (visible) {
          full += visible;
          opts.handlers?.onContent?.(visible);
        }
        pending = pending.slice(partial.index);
        break;
      }

      full += pending;
      opts.handlers?.onContent?.(pending);
      pending = "";
      break;
    }
  }

  if (!suppressingThink && pending) {
    const cleaned = pending
      .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
      .replace(/<\/?think\b[^>]*>/gi, "");
    if (cleaned) {
      full += cleaned;
      opts.handlers?.onContent?.(cleaned);
    }
  }

  return full.trim();
}

/**
 * Stream chat with automatic key/model fallbacks.
 * preferFallback=true when no security keywords (general chat).
 */
export async function streamSentinelChat(opts: {
  messages: ChatCompletionMessageParam[];
  handlers?: StreamHandlers;
  temperature?: number;
  maxTokens?: number;
  showThinking?: boolean;
  /** Prefer OPENROUTER_FALLBACK_API_KEY (used when no security keywords). */
  preferFallback?: boolean;
  onFallback?: (from: string, to: string, reason: string) => void;
}): Promise<string> {
  const chain = getLlmConfigChain({ preferFallback: opts.preferFallback });
  if (!chain.length) {
    throw new Error(
      "No LLM keys configured. Add OPENROUTER_API_KEY and/or OPENROUTER_FALLBACK_API_KEY to ~/.sentineldev/.env",
    );
  }

  const baseTemp = opts.temperature ?? 1.05;
  const temperature = Math.min(
    1.3,
    Math.max(0.7, baseTemp + (Math.random() * 0.15 - 0.05)),
  );

  const errors: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const cfg = chain[i];
    try {
      if (i > 0) {
        opts.onFallback?.(
          chain[i - 1].label,
          cfg.label,
          errors[errors.length - 1] || "previous attempt failed",
        );
      }
      const text = await streamOnce(cfg, {
        messages: opts.messages,
        handlers: opts.handlers,
        temperature,
        maxTokens: opts.maxTokens ?? 4096,
        showThinking: opts.showThinking ?? false,
      });
      if (text) return text;
      errors.push(`${cfg.label}: empty response`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${cfg.label}: ${msg.split("\n")[0]}`);
    }
  }

  throw new Error(
    `All LLM fallbacks failed (${errors.length} attempts):\n- ${errors.join("\n- ")}`,
  );
}

/** True when the user is asking for a security/codebase scan style answer. */
export function isSecurityQuestion(text: string): boolean {
  return /\b(scan|endpoint|route|api|exposed|public|secret|env|key|token|password|database|db|sql|mongo|admin|debug|panel|vuln|vulnerab|security|risk|leak|auth|permission|iam|fix|patch|scramble|rotate|ossprey|osprey|malware|supply[\s-]?chain|dependenc|sbom)\b/i.test(
    text,
  );
}
