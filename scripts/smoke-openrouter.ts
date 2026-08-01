import { loadEnvFiles, userSecretsPath } from "../src/lib/env";
import { getNvidiaConfig, streamSentinelChat } from "../src/lib/nvidia";

async function main() {
  loadEnvFiles();
  const c = getNvidiaConfig();
  if (!c) {
    console.error("No LLM config. Put OPENROUTER_API_KEY in:", userSecretsPath());
    process.exit(1);
  }
  console.log({
    provider: c.provider,
    model: c.model,
    base: c.baseURL,
    keyPrefix: c.apiKey.slice(0, 12) + "...",
    secretsFile: userSecretsPath(),
  });
  const t = await streamSentinelChat({
    messages: [
      { role: "system", content: "You are SentinelDev. One short sentence." },
      { role: "user", content: "Say hi in one sentence." },
    ],
    showThinking: false,
    handlers: { onContent: (s) => process.stdout.write(s) },
  });
  console.log("\nOK_LEN", t.length);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
