/**
 * CLI harness — PLAN-0.3.
 *
 *   npx tsx bin/sim.ts "describe a system..."
 *   npx tsx bin/sim.ts --model url-shortener --rps 50000
 *
 * Prints the model with every parameter's provenance, the simulation at the
 * given load, every finding with its evidence, and the breaking point. No
 * formatting effort beyond readability — this exists so 0.4/0.5's comparison
 * runs can be read in under ten seconds, not to be a product surface.
 */

import { simulate, findBreakingPoint } from "../src/solver.js";
import { referenceModels } from "../models/reference.js";
import { fromProse } from "../src/inference/fromProse.js";
import { isParameter } from "../src/types.js";
import type { Component, SystemModel } from "../src/types.js";

function usage(): never {
  console.error(
    [
      "Usage:",
      '  npx tsx bin/sim.ts "<prose description of a system>"',
      "  npx tsx bin/sim.ts --model <id> [--rps <n>]",
      "",
      `  Reference model ids: ${referenceModels.map((m) => m.id).join(", ")}`,
    ].join("\n"),
  );
  process.exit(1);
}

function round(value: number, dp = 0): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function fmtMs(ms: number): string {
  return Number.isFinite(ms) ? `${round(ms, 1)}ms` : "inf";
}

function printModel(model: SystemModel, inferred: boolean): void {
  console.log(`# ${model.name} (${model.id})${inferred ? "  [inferred]" : ""}`);
  console.log(`workload: ${model.workload.rps.toLocaleString()} rps\n`);

  for (const component of model.components) {
    console.log(`- ${component.id} [${component.kind}] ${component.label}`);
    for (const [key, value] of Object.entries(component as Component)) {
      if (!isParameter(value)) continue;
      console.log(
        `    ${key} = ${value.value}${value.unit}  (${value.provenance}) ${value.rationale}`,
      );
    }
  }

  console.log("\nedges:");
  for (const edge of model.edges) {
    console.log(`  ${edge.from} -> ${edge.to}  x${edge.callsPerRequest}`);
  }
}

function printRun(model: SystemModel): void {
  const result = simulate(model);

  console.log(`\n## Simulation at ${model.workload.rps.toLocaleString()} rps`);
  console.log(`healthy: ${result.healthy}`);
  console.log(
    `end-to-end: mean ${fmtMs(result.endToEndMeanMs)}, p99 ${fmtMs(result.endToEndP99Ms)}\n`,
  );

  for (const c of result.components) {
    const flag = c.saturated ? "  SATURATED" : "";
    console.log(
      `  ${c.componentId}: arrival=${round(c.arrivalRps)}rps capacity=${round(c.capacityRps)}rps ` +
        `util=${(c.utilization * 100).toFixed(1)}% mean=${fmtMs(c.meanLatencyMs)} p99=${fmtMs(c.p99LatencyMs)}${flag}`,
    );
  }

  console.log();
  if (result.findings.length === 0) {
    console.log("No findings at this load.");
  } else {
    console.log("Findings:");
    for (const f of result.findings) {
      console.log(`  [${f.severity.toUpperCase()}] ${f.code} @ ${f.componentId}`);
      for (const [k, v] of Object.entries(f.evidence)) {
        console.log(`      ${k}: ${v}`);
      }
    }
  }

  console.log();
  const breaking = findBreakingPoint(model);
  if (breaking === null) {
    console.log("Breaking point: not reached below 1,000,000 rps.");
  } else {
    console.log(`Breaking point: ${breaking.rps.toLocaleString()} rps`);
    for (const f of breaking.findings) {
      console.log(`  [${f.severity.toUpperCase()}] ${f.code} @ ${f.componentId}`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let modelFlag: string | undefined;
  let rpsFlag: number | undefined;
  const prose: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--model") {
      modelFlag = args[++i];
    } else if (args[i] === "--rps") {
      rpsFlag = Number(args[++i]);
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

  if (rpsFlag !== undefined && !Number.isNaN(rpsFlag)) {
    model = { ...model, workload: { ...model.workload, rps: rpsFlag } };
  }

  printModel(model, inferred);
  printRun(model);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
