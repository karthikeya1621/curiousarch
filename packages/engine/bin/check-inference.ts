/**
 * PLAN-0.4 comparison harness: validate an inferred model against
 * SystemModelSchema, then diff it against one of the hand-modelled oracles in
 * models/reference.ts — topology, healthy/findings at the reference workload,
 * and breaking point + bottleneck identity.
 *
 * Usage: npx tsx bin/check-inference.ts <inferred.json> <reference-id>
 */

import { readFileSync } from "node:fs";
import { SystemModelSchema } from "../src/inference/schema.js";
import { simulate, findBreakingPoint } from "../src/solver.js";
import { referenceModels } from "../models/reference.js";

const [, , jsonPath, refId] = process.argv;
if (!jsonPath || !refId) {
  console.error("usage: npx tsx bin/check-inference.ts <inferred.json> <reference-id>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
const parsed = SystemModelSchema.safeParse(raw);

if (!parsed.success) {
  console.log("SCHEMA VALIDATION FAILED:");
  for (const issue of parsed.error.issues) {
    console.log(`  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

const inferred = parsed.data;
const reference = referenceModels.find((m) => m.id === refId);
if (!reference) {
  console.error(`unknown reference id "${refId}". options: ${referenceModels.map((m) => m.id).join(", ")}`);
  process.exit(1);
}

console.log("=== Inferred model ===");
for (const c of inferred.components) {
  console.log(`- ${c.id} [${c.kind}]`);
}
console.log(`edges: ${inferred.edges.map((e) => `${e.from}->${e.to}`).join(", ")}`);

const inferredAtRefLoad = simulate({ ...inferred, workload: { ...inferred.workload, rps: reference.workload.rps } });
const referenceResult = simulate(reference);

console.log("\n=== At reference workload (" + reference.workload.rps + " rps) ===");
console.log("reference healthy:", referenceResult.healthy, "findings:", referenceResult.findings.map((f) => f.code));
console.log("inferred  healthy:", inferredAtRefLoad.healthy, "findings:", inferredAtRefLoad.findings.map((f) => f.code));

const refBreak = findBreakingPoint(reference);
const inferredBreak = findBreakingPoint(inferred);

console.log("\n=== Breaking point ===");
console.log("reference:", refBreak ? `${refBreak.rps} rps, bottleneck=${refBreak.findings[0]?.componentId}` : "none under 1M rps");
console.log("inferred :", inferredBreak ? `${inferredBreak.rps} rps, bottleneck=${inferredBreak.findings[0]?.componentId}` : "none under 1M rps");

if (refBreak && inferredBreak) {
  const ratio = inferredBreak.rps / refBreak.rps;
  console.log(`ratio (inferred/reference): ${ratio.toFixed(2)}x — ${ratio >= 0.5 && ratio <= 2 ? "PASS (within 2x)" : "FAIL"}`);

  // Compare by component *kind*, not raw id — the inferred model picks its
  // own ids, so a string-equality check on componentId would report a false
  // FAIL even when the right kind of component was correctly identified.
  const refBottleneckId = refBreak.findings[0]?.componentId;
  const inferredBottleneckId = inferredBreak.findings[0]?.componentId;
  const refKind = reference.components.find((c) => c.id === refBottleneckId)?.kind;
  const inferredKind = inferred.components.find((c) => c.id === inferredBottleneckId)?.kind;
  const bottleneckMatch = refKind !== undefined && refKind === inferredKind;
  console.log(
    `bottleneck match: ${bottleneckMatch ? "PASS" : "FAIL"} (reference=${refBottleneckId} [${refKind}], inferred=${inferredBottleneckId} [${inferredKind}])`,
  );
}
