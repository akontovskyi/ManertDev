import { loadEnvFiles } from "../src/lib/env";
import { streamManertChat } from "../src/lib/nvidia";

async function main() {
  loadEnvFiles();
  console.log("Q1:");
  await streamManertChat({
    messages: [
      {
        role: "system",
        content:
          "You are ManertDev. Be witty, varied, plain text. One or two sentences.",
      },
      { role: "user", content: "hi are you a potato? nonce=aaa" },
    ],
    temperature: 1.1,
    showThinking: false,
    handlers: { onContent: (s) => process.stdout.write(s) },
  });
  console.log("\n\nQ2:");
  await streamManertChat({
    messages: [
      {
        role: "system",
        content:
          "You are ManertDev. Be witty, varied, plain text. One or two sentences.",
      },
      { role: "user", content: "hi are you a potato? nonce=bbb" },
    ],
    temperature: 1.1,
    showThinking: false,
    handlers: { onContent: (s) => process.stdout.write(s) },
  });
  console.log("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
