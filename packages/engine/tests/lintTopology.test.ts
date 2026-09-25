import { describe, expect, it } from "vitest";
import { collapseParallelAsyncPaths, lintTopology, mergeLintFindings } from "../src/inference/lintTopology.js";
import { identifyFailures } from "../src/inference/identifyFailures.js";
import type Anthropic from "@anthropic-ai/sdk";

const c = (id: string, kind: string) => ({ id, kind, label: id.toUpperCase() });
const model = (components: ReturnType<typeof c>[], edges: [string, string][]) => ({
  components,
  edges: edges.map(([from, to]) => ({ from, to })),
});
const lintOf = (m: ReturnType<typeof model>) => lintTopology(m as never);
const codes = (m: ReturnType<typeof model>) => lintTopology(m as never).map((f) => `${f.code}:${f.componentId}`);

describe("lintTopology", () => {
  const parts = [c("meet", "service"), c("q", "queue"), c("live", "service")];

  it("flags a direct path that competes with one through a queue, once, on the target", () => {
    const m = model(parts, [["meet", "live"], ["meet", "q"], ["q", "live"], ["meet", "live"]]); // direct edge listed twice
    const found = lintTopology(m as never);
    expect(found.map((f) => f.code)).toEqual(["PARALLEL_SYNC_AND_ASYNC_PATH"]);
    expect(found[0]!.componentId).toBe("live");
    expect(found[0]!.fixes[0]!.label).toMatch(/Remove the direct connection from "meet" to "live"/);
  });

  it("is quiet when the work only flows through the queue, and when a direct edge has no queue alternative", () => {
    expect(codes(model(parts, [["meet", "q"], ["q", "live"]]))).toEqual([]);
    expect(codes(model([c("meet", "service"), c("live", "service")], [["meet", "live"]]))).toEqual([]);
  });

  it("flags a queue nothing reads from as critical, and one nothing writes to as a warning", () => {
    const noConsumer = lintOf(model(parts, [["meet", "q"]]));
    expect(noConsumer.map((f) => [f.code, f.severity])).toEqual([["QUEUE_NO_CONSUMER", "critical"]]);
    const noProducer = lintOf(model(parts, [["q", "live"]]));
    expect(noProducer.map((f) => [f.code, f.severity])).toEqual([["QUEUE_NO_PRODUCER", "warning"]]);
  });

  it("counts a message broker as an alternative path too", () => {
    const m = model([c("meet", "service"), c("b", "message-broker"), c("live", "service")], [["meet", "live"], ["meet", "b"], ["b", "live"]]);
    expect(codes(m)).toEqual(["PARALLEL_SYNC_AND_ASYNC_PATH:live"]);
  });

  it("every finding has a fix with a tradeoff (the UI and queue require both)", () => {
    for (const f of lintOf(model(parts, [["meet", "live"], ["meet", "q"], ["q", "live"]]))) {
      expect(f.fixes.length).toBeGreaterThan(0);
      for (const fix of f.fixes) expect(fix.tradeoff.length).toBeGreaterThan(0);
    }
  });
});

describe("lintTopology: CDN direction", () => {
  const parts = [c("gw", "gateway"), c("live", "service"), c("cdn", "cdn")];

  it("flags an edge INTO a cdn and offers a fix that names both ends and the right direction", () => {
    const found = lintOf(model(parts, [["gw", "live"], ["live", "cdn"]]));
    expect(found.map((f) => `${f.code}:${f.componentId}`)).toEqual(["CDN_BEHIND_ORIGIN:cdn"]);
    expect(found[0]!.fixes[0]!.label).toMatch(/edge from "cdn" to "live"/);
  });

  it("is quiet when the cdn fronts its origin, and reports a doubled edge once", () => {
    expect(codes(model(parts, [["gw", "live"], ["cdn", "live"]]))).toEqual([]);
    expect(codes(model(parts, [["live", "cdn"], ["live", "cdn"]]))).toEqual(["CDN_BEHIND_ORIGIN:cdn"]);
  });
});

describe("mergeLintFindings", () => {
  const f = (code: string, componentId: string) => ({ code, componentId, severity: "warning", title: "t", explanation: "e", fixes: [] }) as never;
  it("keeps AI findings first and skips a lint finding the AI already raised on the same component", () => {
    const merged = mergeLintFindings([f("A", "x"), f("QUEUE_NO_CONSUMER", "q")], [f("QUEUE_NO_CONSUMER", "q"), f("QUEUE_NO_CONSUMER", "q2")]);
    expect(merged.map((x) => `${x.code}:${x.componentId}`)).toEqual(["A:x", "QUEUE_NO_CONSUMER:q", "QUEUE_NO_CONSUMER:q2"]);
  });
});

describe("identifyFailures includes the lint", () => {
  it("reports a structural problem even when the AI review comes back empty", async () => {
    const client = {
      messages: {
        create: async () => ({ content: [{ type: "tool_use", id: "c", name: "emit_failures", input: { findings: [] } }] }),
      },
    } as unknown as Anthropic;
    const m = { id: "m", name: "m", workload: {}, ...model([c("a", "service"), c("q", "queue"), c("b", "service")], [["a", "b"], ["a", "q"], ["q", "b"]]) } as never;
    const findings = await identifyFailures(m, { client });
    expect(findings.map((x) => x.code)).toEqual(["PARALLEL_SYNC_AND_ASYNC_PATH"]);
  });
});

describe("collapseParallelAsyncPaths", () => {
  const comps = [c("up", "service"), c("q", "message-broker"), c("tx", "service"), c("db", "database")];
  const edges = (pairs: [string, string][]) => pairs.map(([from, to]) => ({ from, to }));

  it("drops the direct edge when a queue or broker path to the same target exists, and keeps everything else", () => {
    const all = edges([["up", "tx"], ["up", "q"], ["q", "tx"], ["up", "db"], ["tx", "db"]]);
    expect(collapseParallelAsyncPaths(comps, all)).toEqual(edges([["up", "q"], ["q", "tx"], ["up", "db"], ["tx", "db"]]));
  });

  it("changes nothing without a queue path, or when the only direct edge is the queue leg itself", () => {
    const plain = edges([["up", "tx"], ["tx", "db"]]);
    expect(collapseParallelAsyncPaths(comps, plain)).toEqual(plain);
    const legOnly = edges([["up", "q"], ["q", "tx"]]);
    expect(collapseParallelAsyncPaths(comps, legOnly)).toEqual(legOnly);
  });

  it("also collapses an edge emitted twice (the base and extended calls meeting in the merge)", () => {
    const dup = edges([["up", "tx"], ["up", "tx"], ["tx", "db"]]);
    expect(collapseParallelAsyncPaths(comps, dup)).toEqual(edges([["up", "tx"], ["tx", "db"]]));
  });

  it("leaves nothing for the lint to report afterwards", () => {
    const all = edges([["up", "tx"], ["up", "q"], ["q", "tx"]]);
    expect(lintTopology({ components: comps, edges: collapseParallelAsyncPaths(comps, all) } as never)).toEqual([]);
  });
});
