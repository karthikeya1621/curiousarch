import { describe, expect, it } from "vitest";
import { collapseParallelAsyncPaths, lintTopology, mergeLintFindings, routableLoadBalancers } from "../src/inference/lintTopology.js";
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

describe("a load balancer is a pass-through too", () => {
  const comps = [c("gw", "gateway"), c("lb", "load-balancer"), c("svc", "service")];
  const edges = (pairs: [string, string][]) => pairs.map(([from, to]) => ({ from, to }));

  it("lints a direct edge that goes around a load balancer, with its own code and a fix that names the balancer", () => {
    const found = lintTopology({ components: comps, edges: edges([["gw", "svc"], ["gw", "lb"], ["lb", "svc"]]) } as never);
    expect(found.map((f) => `${f.code}:${f.componentId}`)).toEqual(["PATH_AROUND_LOAD_BALANCER:svc"]);
    expect(found[0]!.fixes[0]!.label).toMatch(/load balancer "lb"/);
  });

  it("collapses the direct edge and leaves the path through the balancer", () => {
    const all = edges([["gw", "svc"], ["gw", "lb"], ["lb", "svc"]]);
    expect(collapseParallelAsyncPaths(comps, all)).toEqual(edges([["gw", "lb"], ["lb", "svc"]]));
    expect(lintTopology({ components: comps, edges: collapseParallelAsyncPaths(comps, all) } as never)).toEqual([]);
  });

  it("does not touch a balancer's own legs, or a direct edge to a different service", () => {
    const legs = edges([["gw", "lb"], ["lb", "svc"]]);
    expect(collapseParallelAsyncPaths(comps, legs)).toEqual(legs);
    const other = [...comps, c("svc2", "service")];
    const split = edges([["gw", "svc2"], ["gw", "lb"], ["lb", "svc"]]);
    expect(collapseParallelAsyncPaths(other, split)).toEqual(split);
  });
});

describe("a load balancer sits between its callers and what it balances", () => {
  const comps = [c("gw", "gateway"), c("lb", "load-balancer"), c("svc", "service"), c("other", "service"), c("job", "scheduled-job"), c("q", "queue")];
  const edges = (pairs: [string, string][]) => pairs.map(([from, to]) => ({ from, to }));

  it("rewires a caller that reaches the balanced service directly through the balancer", () => {
    // the balancer only has an outgoing edge to the service; the gateway still calls the service itself
    expect(collapseParallelAsyncPaths(comps, edges([["gw", "svc"], ["lb", "svc"]]))).toEqual(edges([["gw", "lb"], ["lb", "svc"]]));
  });

  it("rewires every gateway or service caller, but leaves a queue or a scheduled job that reaches it alone", () => {
    const all = edges([["gw", "svc"], ["other", "svc"], ["lb", "svc"], ["job", "svc"], ["q", "svc"]]);
    expect(collapseParallelAsyncPaths(comps, all)).toEqual(
      edges([["gw", "lb"], ["other", "lb"], ["lb", "svc"], ["job", "svc"], ["q", "svc"]]),
    );
  });

  it("does not rewire when it would close a cycle, and does nothing without a balancer", () => {
    const cyc = edges([["svc", "other"], ["other", "gw"], ["lb", "svc"], ["gw", "svc"]]);
    // lb -> svc -> other -> gw: gw is reachable from lb, so gw -> svc must stay as it was
    expect(collapseParallelAsyncPaths(comps, cyc)).toEqual(cyc);
    const plain = edges([["gw", "svc"], ["svc", "other"]]);
    expect(collapseParallelAsyncPaths(comps, plain)).toEqual(plain);
  });

  it("lints a caller that bypasses the balancer in front of its target (once per edge), and stays quiet once it goes through it", () => {
    const lintComps = comps.filter((x) => x.id !== "q"); // (an edgeless queue would be linted itself)
    const bypass = lintTopology({ components: lintComps, edges: edges([["gw", "svc"], ["lb", "svc"]]) } as never);
    expect(bypass.map((f) => `${f.code}:${f.componentId}`)).toEqual(["PATH_AROUND_LOAD_BALANCER:svc"]);
    expect(bypass[0]!.fixes[0]!.label).toMatch(/edge from "gw" to "lb"/);
    expect(lintTopology({ components: lintComps, edges: edges([["gw", "lb"], ["lb", "svc"]]) } as never)).toEqual([]);
  });
});

describe("only a newly added balancer is routed through — an existing one is the user's to keep", () => {
  const comps = [c("gw", "gateway"), c("lb", "load-balancer"), c("svc", "service"), c("admin", "service")];
  const edges = (pairs: [string, string][]) => pairs.map(([from, to]) => ({ from, to }));
  const wiring = edges([["gw", "svc"], ["admin", "svc"], ["lb", "svc"]]);

  it("routes callers through a balancer that is in the allowed set, and leaves everything alone for one that is not", () => {
    expect(collapseParallelAsyncPaths(comps, wiring, new Set(["lb"]))).toEqual(edges([["gw", "lb"], ["admin", "lb"], ["lb", "svc"]]));
    expect(collapseParallelAsyncPaths(comps, wiring, new Set())).toEqual(wiring);
  });

  it("does not collapse a direct edge beside X -> LB -> S either when that balancer isn't allowed", () => {
    const parallel = edges([["gw", "svc"], ["gw", "lb"], ["lb", "svc"]]);
    expect(collapseParallelAsyncPaths(comps, parallel, new Set())).toEqual(parallel);
    expect(collapseParallelAsyncPaths(comps, parallel, new Set(["lb"]))).toEqual(edges([["gw", "lb"], ["lb", "svc"]]));
  });

  it("routableLoadBalancers: a balancer new in the result is routable, an existing one is not", () => {
    const input = { components: [c("gw", "gateway"), c("lb-old", "load-balancer")] };
    const result = { components: [c("gw", "gateway"), c("lb-old", "load-balancer"), c("lb-new", "load-balancer")] };
    expect([...routableLoadBalancers(input, result)]).toEqual(["lb-new"]);
  });

});
