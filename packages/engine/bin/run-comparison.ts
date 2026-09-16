/**
 * PLAN-0.4 comparison runner, through the real inference pipeline.
 *
 * Calls fromProse() (one live API call, one repair retry on validation
 * failure), saves the raw inferred model to docs/inference-runs/, and diffs
 * it against a hand-modelled oracle in models/reference.ts the same way
 * bin/check-inference.ts does for pre-saved JSON.
 *
 * Usage: ANTHROPIC_API_KEY=... npx tsx bin/run-comparison.ts <reference-id> "<prose>" <output-name>
 */

import { writeFileSync } from "node:fs";
import { fromProse } from "../src/inference/fromProse.js";
import { simulate, findBreakingPoint } from "../src/solver.js";
import { referenceModels } from "../models/reference.js";

const [, , refId, prose, outputName] = process.argv;
if (!refId || !prose || !outputName) {
  console.error(
    'usage: npx tsx bin/run-comparison.ts <reference-id> "<prose>" <output-name>',
  );
  process.exit(1);
}

const reference = referenceModels.find((m) => m.id === refId);
if (!reference) {
  console.error(
    `unknown reference id "${refId}". options: ${referenceModels.map((m) => m.id).join(", ")}`,
  );
  process.exit(1);
}

console.error("Calling fromProse (live API call)...");
const result = await fromProse(prose);
console.error(`Done. repaired: ${result.repaired}`);

const outPath = `docs/inference-runs/${outputName}.json`;
writeFileSync(outPath, JSON.stringify(result.model, null, 2) + "\n");
console.error(`Saved inferred model to ${outPath}`);

const inferred = result.model;

console.log("\n=== Inferred model ===");
for (const c of inferred.components) {
  console.log(`- ${c.id} [${c.kind}]`);
}
console.log(`edges: ${inferred.edges.map((e) => `${e.from}->${e.to}`).join(", ")}`);

const inferredAtRefLoad = simulate({
  ...inferred,
  workload: { ...inferred.workload, rps: reference.workload.rps },
});
const referenceResult = simulate(reference);

console.log(`\n=== At reference workload (${reference.workload.rps} rps) ===`);
console.log(
  "reference healthy:",
  referenceResult.healthy,
  "findings:",
  referenceResult.findings.map((f) => f.code),
);
console.log(
  "inferred  healthy:",
  inferredAtRefLoad.healthy,
  "findings:",
  inferredAtRefLoad.findings.map((f) => f.code),
);

const refBreak = findBreakingPoint(reference);
const inferredBreak = findBreakingPoint(inferred);

console.log("\n=== Breaking point ===");
console.log(
  "reference:",
  refBreak ? `${refBreak.rps} rps, bottleneck=${refBreak.findings[0]?.componentId}` : "none under 1M rps",
);
console.log(
  "inferred :",
  inferredBreak ? `${inferredBreak.rps} rps, bottleneck=${inferredBreak.findings[0]?.componentId}` : "none under 1M rps",
);

if (refBreak && inferredBreak) {
  const ratio = inferredBreak.rps / refBreak.rps;
  console.log(
    `ratio (inferred/reference): ${ratio.toFixed(2)}x — ${ratio >= 0.5 && ratio <= 2 ? "PASS (within 2x)" : "FAIL"}`,
  );

  // Compare by component *kind*, not raw id — the model picks its own ids
  // ("transcode-queue" vs the hand-model's "queue"), so a string-equality
  // check on componentId would report a false FAIL for a correct match.
  const refBottleneckId = refBreak.findings[0]?.componentId;
  const inferredBottleneckId = inferredBreak.findings[0]?.componentId;
  const refKind = reference.components.find((c) => c.id === refBottleneckId)?.kind;
  const inferredKind = inferred.components.find((c) => c.id === inferredBottleneckId)?.kind;
  const bottleneckMatch = refKind !== undefined && refKind === inferredKind;
  console.log(
    `bottleneck match: ${bottleneckMatch ? "PASS" : "FAIL"} (reference=${refBottleneckId} [${refKind}], inferred=${inferredBottleneckId} [${inferredKind}])`,
  );
}
