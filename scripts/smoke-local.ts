import { runScan } from "../src/scanners";
import { analyzeLocally } from "../src/lib/local-analyst";

async function main() {
  const r = await runScan({
    root: "./fixtures",
    kind: "endpoints",
    query: "endpoints",
  });
  const a = analyzeLocally(r);
  console.log(a.headline);
  console.log("risk", a.riskLabel, a.riskScore);
  console.log("priority", a.priorityQueue.length);
  console.log("OFFLINE_OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
