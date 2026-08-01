/**
 * NVIDIA / OpenAI-compatible client — OPTIONAL narration layer only.
 * SentinelDev's security value lives in src/scanners/* and src/lib/local-analyst.ts.
 * If this module is removed, scans and local reports still work.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export interface NvidiaConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export function getNvidiaConfig(): NvidiaConfig | null {
  const apiKey =
    process.env.NVIDIA_API_KEY ||
    process.env.NVAPI_KEY ||
    process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseURL:
      process.env.NVIDIA_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      "https://integrate.api.nvidia.com/v1",
    model:
      process.env.NVIDIA_MODEL ||
      process.env.OPENAI_MODEL ||
      "nvidia/nemotron-3-ultra-550b-a55b",
  };
}

export function createNvidiaClient(cfg?: NvidiaConfig): OpenAI | null {
  const config = cfg || getNvidiaConfig();
  if (!config) return null;
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });
}

export const SENTINEL_SYSTEM_PROMPT = `You are SentinelDev's OPTIONAL narration layer.

CRITICAL ARCHITECTURE FACTS:
- Local scanners in the SentinelDev CLI already found every finding. You did NOT discover them.
- You NEVER invent endpoints, secrets, routes, or IAM principals.
- You ONLY explain, prioritize, and propose remediations using the provided SCAN_EVIDENCE_JSON / LOCAL_ANALYST text.
- If evidence is empty, say the local scanners found nothing — do not hallucinate issues.
- You run in a terminal. Plain text only. No markdown tables, HTML, or web UI.
- You NEVER modify code. Propose diffs only when asked (fix/patch/apply).
- Cite exact file:line from evidence.

Output shape:
Summary
Findings (with file:line from evidence only)
Evidence
Proposed Fixes
Optional Patch (only if user asked)
`;

export type StreamHandlers = {
  onReasoning?: (text: string) => void;
  onContent?: (text: string) => void;
};

/**
 * Stream a chat completion from NVIDIA Nemotron (OpenAI-compatible).
 */
export async function streamSentinelChat(opts: {
  messages: ChatCompletionMessageParam[];
  handlers?: StreamHandlers;
}): Promise<string> {
  const cfg = getNvidiaConfig();
  const client = createNvidiaClient(cfg || undefined);
  if (!client || !cfg) {
    throw new Error(
      "NVIDIA_API_KEY is not set. Add it to .env.local or ~/.sentineldev/.env",
    );
  }

  const stream = await client.chat.completions.create({
    model: cfg.model,
    messages: opts.messages,
    temperature: 1,
    top_p: 0.95,
    max_tokens: 16384,
    stream: true,
    ...({
      chat_template_kwargs: { enable_thinking: true },
      reasoning_budget: 16384,
    } as object),
  });

  let full = "";
  for await (const chunk of stream) {
    if (!chunk.choices?.length) continue;
    const delta = chunk.choices[0].delta as {
      content?: string | null;
      reasoning_content?: string | null;
    };
    const reasoning = delta?.reasoning_content;
    if (reasoning) opts.handlers?.onReasoning?.(reasoning);
    const content = delta?.content;
    if (content) {
      full += content;
      opts.handlers?.onContent?.(content);
    }
  }
  return full;
}
