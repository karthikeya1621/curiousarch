/**
 * What-if CLI: indicator -> failures -> fixes with tradeoffs -> resimulate.
 *
 *   npx tsx bin/whatif.ts --model checkout
 *     Every node with a possible failure (an "indicator"), and what those
 *     failures are.
 *
 *   npx tsx bin/whatif.ts --model checkout --scenario svc:loses-instance
 *     Applies that failure, shows the delta against baseline, and lists
 *     fixes (with tradeoffs) for whatever it broke.
 *
 *   npx tsx bin/whatif.ts --model checkout --scenario svc:loses-instance --fix svc:add-instance
 *     Applies the failure, then the fix on top of it, and shows whether the
 *     fix actually resolved what the failure broke.
 *
 * Also accepts prose (via fromProse, needs ANTHROPIC_API_KEY) in place of
 * --model, same as bin/sim.ts. No new facts are inferred by any of this —
 * every scenario and fix is a fixed, hand-written trait flip on whatever
 * the baseline model already has.
 */

import { simulate } from "../src/solver.js";
import { listScenarios, compareScenario } from "../src/whatif.js";
import { listFixes, compareFix } from "../src/fixes.js";
import { referenceModels } from "../models/reference.js";
import { fromProse } from "../src/inference/fromProse.js";
import type { Component, SystemModel } from "../src/types.js";

function usage(): never {
  console.error(
    [
      "Usage:",
      "  npx tsx bin/whatif.ts --model <id>",
      "  npx tsx bin/whatif.ts --model <id> --scenario <scenario-id>",
      "  npx tsx bin/whatif.ts --model <id> --scenario <scenario-id> --fix <fix-id>",
      '  npx tsx bin/whatif.ts "<prose description>" [--scenario <id>] [--fix <id>]',
      "",
      `  Reference model ids: ${referenceModels.map((m) => m.id).join(", ")}`,
    ].join("\n"),
  );
  process.exit(1);
}

function findingsLine(findings: { code: string }[]): string {
  return findings.map((f) => f.code).join(", ") || "none";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let modelFlag: string | undefined;
  let scenarioFlag: string | undefined;
  let fixFlag: string | undefined;
  const prose: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--model") modelFlag = args[++i];
    else if (args[i] === "--scenario") scenarioFlag = args[++i];
    else if (args[i] === "--fix") fixFlag = args[++i];
    else prose.push(args[i]!);
  }

  let model: SystemModel;
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
    model = (await fromProse(prose.join(" "))).model;
  } else {
    usage();
  }

  // --- Step 1: no scenario picked yet — every node is an indicator, listing
  // the failures it could plausibly suffer. -------------------------------
  if (!scenarioFlag) {
    const baseline = simulate(model);
    const scenarios = listScenarios(model);
    const byComponent = new Map<string, typeof scenarios>();
    for (const s of scenarios) {
      const key = s.id.startsWith("workload:") ? "(traffic)" : s.id.split(":")[0]!;
      byComponent.set(key, [...(byComponent.get(key) ?? []), s]);
    }

    console.log(`# ${model.name} (${model.id})`);
    console.log(
      `baseline: ${model.workload.scale?.value ?? "unspecified"} scale, healthy=${baseline.healthy}, ` +
        `findings: ${findingsLine(baseline.findings)}\n`,
    );

    const componentById = new Map(model.components.map((c) => [c.id, c] as [string, Component]));
    for (const [key, group] of byComponent) {
      const label = key === "(traffic)" ? "Traffic" : `${componentById.get(key)?.label ?? key} [${key}]`;
      console.log(`⚠ ${label} — ${group.length} possible failure(s):`);
      for (const s of group) {
        console.log(`    ${s.id}`);
        console.log(`      ${s.description}`);
      }
    }
    console.log(`\nRe-run with --scenario <id> to explore one.`);
    return;
  }

  const scenarios = listScenarios(model);
  const scenario = scenarios.find((s) => s.id === scenarioFlag);
  if (!scenario) {
    console.error(
      `Scenario "${scenarioFlag}" doesn't apply to this model. Options:\n` +
        scenarios.map((s) => `  ${s.id}`).join("\n"),
    );
    process.exit(1);
  }

  // --- Step 3: a fix was picked too — apply failure + fix, show whether it
  // actually resolved what the failure broke. -----------------------------
  if (fixFlag) {
    const result = compareFix(model, scenarioFlag, fixFlag);

    console.log(`# ${model.name} (${model.id})`);
    console.log(`Failure: ${result.scenario.label}`);
    console.log(`Fix:     ${result.fix.label}`);
    console.log(`Tradeoff: ${result.fix.tradeoff}\n`);

    console.log("baseline:      ", `healthy=${result.baseline.healthy}`, ` findings: ${findingsLine(result.baseline.findings)}`);
    console.log("under failure: ", `healthy=${result.underFailure.healthy}`, ` findings: ${findingsLine(result.underFailure.findings)}`);
    console.log("failure + fix: ", `healthy=${result.underFix.healthy}`, ` findings: ${findingsLine(result.underFix.findings)}`);

    console.log();
    if (result.resolved) {
      console.log(`✓ resolved: ${result.fix.targetsFindingCode} is no longer present.`);
    } else {
      console.log(`✗ not resolved: ${result.fix.targetsFindingCode} is still present after this fix.`);
    }
    const remaining = result.underFix.findings.map((f) => f.code).filter((c) => c !== result.fix.targetsFindingCode);
    if (remaining.length > 0) {
      console.log(`Other findings still present (this fix doesn't target them): ${remaining.join(", ")}`);
    }
    return;
  }

  // --- Step 2: a failure was picked — show its impact, then list fixes. --
  const delta = compareScenario(model, scenarioFlag);

  console.log(`# ${model.name} (${model.id}) — ${delta.scenario.label}\n`);
  console.log(`${delta.scenario.description}\n`);

  console.log("baseline:");
  console.log(`  healthy=${delta.baseline.healthy}  findings: ${findingsLine(delta.baseline.findings)}`);
  console.log("under this failure:");
  console.log(`  healthy=${delta.underScenario.healthy}  findings: ${findingsLine(delta.underScenario.findings)}`);

  if (delta.newlyUnhealthy) {
    console.log("\n⚠ this failure breaks a system that was healthy at baseline.");
  }

  const fixes = listFixes(model, scenarioFlag);
  console.log();
  if (fixes.length === 0) {
    console.log("No fixes to offer — this failure doesn't break anything at the current scale.");
  } else {
    console.log(`${fixes.length} fix(es) available:\n`);
    for (const fix of fixes) {
      console.log(`  ${fix.id}  (targets ${fix.targetsFindingCode})`);
      console.log(`    ${fix.label}`);
      console.log(`    Tradeoff: ${fix.tradeoff}`);
    }
    console.log(`\nRe-run with --fix <id> to apply one and see if it resolves this.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
