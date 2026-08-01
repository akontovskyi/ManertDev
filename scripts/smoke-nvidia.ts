import { loadEnvFiles } from "../src/lib/env";
import { getNvidiaConfig, streamManertChat } from "../src/lib/nvidia";

async function main() {
  loadEnvFiles();
  const c = getNvidiaConfig();
  console.log(
    "cfg",
    c && { model: c.model, base: c.baseURL, key: c.apiKey.slice(0, 12) + "..." },
  );
  if (!c) {
    console.error("No NVIDIA config");
    process.exit(1);
  }
  const t = await streamManertChat({
    messages: [
      {
        role: "system",
        content: "You are ManertDev. Reply in one short plain sentence.",
      },
      { role: "user", content: "Say hello as ManertDev in one sentence." },
    ],
    handlers: {
      onReasoning: (s) => process.stdout.write(s),
      onContent: (s) => process.stdout.write(s),
    },
  });
  console.log("\nDONE_LEN", t.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
