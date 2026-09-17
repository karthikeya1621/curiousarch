/**
 * CLI harness.
 *
 *   npx tsx bin/sim.ts "describe a system..."
 *   npx tsx bin/sim.ts --model url-shortener --scale large
 *
 * Prints the model with every trait's provenance, the findings the pattern
 * catalogue produces, and the breaking tier. No formatting effort beyond
 * readability — this exists so a run can be read in under ten seconds, not
 * to be a product surface.
 */

import { simulate, findBreakingTier } from "../src/solver.js";
import { referenceModels } from "../models/reference.js";
import { fromProse } from "../src/inference/fromProse.js";
import { isTrait } from "../src/types.js";
import type { Component, ScaleTier, SystemModel } from "../src/types.js";

const SCALE_TIERS: ScaleTier[] = ["small", "medium", "large", "massive"];

function usage(): never {
  console.error(
    [
      "Usage:",
      '  npx tsx bin/sim.ts "<prose description of a system>"',
      "  npx tsx bin/sim.ts --model <id> [--scale <small|medium|large|massive>]",
      "",
      `  Reference model ids: ${referenceModels.map((m) => m.id).join(", ")}`,
    ].join("\n"),
  );
  process.exit(1);
}

function printModel(model: SystemModel, inferred: boolean): void {
  console.log(`# ${model.name} (${model.id})${inferred ? "  [inferred]" : ""}`);
  console.log(`workload scale: ${model.workload.scale.value} (${model.workload.scale.provenance}) ${model.workload.scale.rationale}\n`);

  for (const component of model.components) {
    console.log(`- ${component.id} [${component.kind}] ${component.label}`);
    for (const [key, value] of Object.entries(component as Component)) {
      if (!isTrait(value)) continue;
      console.log(`    ${key} = ${value.value}  (${value.provenance}) ${value.rationale}`);
    }
  }

  console.log("\nedges:");
  for (const edge of model.edges) {
    console.log(`  ${edge.from} -> ${edge.to}`);
  }
}

function printRun(model: SystemModel): void {
  const result = simulate(model);

  console.log(`\n## Findings at ${model.workload.scale.value} scale`);
  console.log(`healthy: ${result.healthy}\n`);

  if (result.findings.length === 0) {
    console.log("No findings at this scale.");
  } else {
    for (const f of result.findings) {
      console.log(`  [${f.severity.toUpperCase()}] ${f.code} @ ${f.componentId}`);
      for (const [k, v] of Object.entries(f.evidence)) {
        console.log(`      ${k}: ${v}`);
      }
    }
  }

  console.log();
  const breaking = findBreakingTier(model);
  if (breaking === null) {
    console.log("Breaking tier: not reached at any scale.");
  } else {
    console.log(`Breaking tier: ${breaking.scale}`);
    for (const f of breaking.findings) {
      console.log(`  [${f.severity.toUpperCase()}] ${f.code} @ ${f.componentId}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let modelFlag: string | undefined;
  let scaleFlag: string | undefined;
  const prose: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--model") {
      modelFlag = args[++i];
    } else if (args[i] === "--scale") {
      scaleFlag = args[++i];
    } else {
      prose.push(args[i]!);
    }
  }

  let model: SystemModel;
  let inferred = false;

  if (modelFlag) {
    const found = referenceModels.find((m) => m.id === modelFlag);
    if (!found) {
      console.error(
        `Unknown --model "${modelFlag}". Options: ${referenceModels.map((m) => m.id).join(", ")}`,
      );
      process.exit(1);
    }
    model = found;
  } else if (prose.length > 0) {
    process.stderr.write("Inferring model from prose...\n");
    const result = await fromProse(prose.join(" "));
    model = result.model;
    inferred = true;
    if (result.repaired) {
      process.stderr.write("(structured output needed one repair retry)\n");
    }
  } else {
    usage();
  }

  if (scaleFlag) {
    if (!SCALE_TIERS.includes(scaleFlag as ScaleTier)) {
      console.error(`Unknown --scale "${scaleFlag}". Options: ${SCALE_TIERS.join(", ")}`);
      process.exit(1);
    }
    model = { ...model, workload: { scale: { ...model.workload.scale, value: scaleFlag as ScaleTier } } };
  }

  printModel(model, inferred);
  printRun(model);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
