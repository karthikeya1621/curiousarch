import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { applyGraphEdits, reviewGraph } from "../src/inference/reviewGraph.js";
import { fromProse } from "../src/inference/fromProse.js";
import { reworkModel } from "../src/inference/reworkModel.js";
import { checkout } from "../models/reference.js";

const comps = [
  { id: "gw", kind: "gateway", label: "Gateway" },
  { id: "lb", kind: "load-balancer", label: "LB" },
  { id: "svc", kind: "service", label: "Service" },
  { id: "cdn", kind: "cdn", label: "CDN" },
];
const e = (from: string, to: string) => ({ from, to });
const edit = (action: "remove" | "add" | "reverse", from: string, to: string) => ({ action, from, to, reason: "because" });
const edges = [e("gw", "svc"), e("gw", "lb"), e("lb", "svc"), e("svc", "cdn")];

describe("applyGraphEdits — code only validates", () => {
  it("applies a remove of a redundant edge (another path exists), an add and a reverse", () => {
    expect(applyGraphEdits(comps, edges, [edit("remove", "gw", "svc")]).edges).toEqual([e("gw", "lb"), e("lb", "svc"), e("svc", "cdn")]);
    const reversed = applyGraphEdits(comps, edges, [edit("reverse", "svc", "cdn")]);
    expect(reversed.problem).toBeNull();
    expect(reversed.edges).toContainEqual(e("cdn", "svc"));
    expect(applyGraphEdits(comps, [e("gw", "lb")], [edit("add", "lb", "svc")]).edges).toEqual([e("gw", "lb"), e("lb", "svc")]);
  });

  it.each([
    ["an unknown id", [edit("remove", "gw", "ghost")], /existing component ids/],
    ["removing an edge that isn't there", [edit("remove", "svc", "gw")], /no such edge/],
    ["adding one that exists", [edit("add", "gw", "svc")], /already exists/],
    ["a self-loop", [edit("add", "gw", "gw")], /itself/],
    ["a removal that disconnects (no other path)", [edit("remove", "svc", "cdn")], /would disconnect them/],
    ["an edit that creates a cycle", [edit("add", "svc", "gw")], /cycle/],
    ["too many edits", Array.from({ length: 9 }, () => edit("add", "gw", "cdn")), /At most 8/],
  ])("rejects %s", (_label, edits, message) => {
    expect(applyGraphEdits(comps, edges, edits).problem).toMatch(message);
  });

  it("rejects an edit that leaves a component with no edges at all", () => {
    expect(applyGraphEdits(comps, [e("gw", "svc"), e("svc", "cdn")], [edit("reverse", "svc", "cdn"), edit("remove", "gw", "svc")]).problem).toBeTruthy();
  });
});

function fakeClient(responses: (Anthropic.Message | Error)[], seen?: { tool: string; content: string }[]): Anthropic {
  let call = 0;
  return {
    messages: {
      create: async (params: { tools?: { name: string }[]; messages: { content: unknown }[] }) => {
        seen?.push({ tool: params.tools?.[0]?.name ?? "", content: JSON.stringify(params.messages[0]!.content) });
        const r = responses[call++];
        if (!r) throw new Error("fakeClient: no more canned responses");
        if (r instanceof Error) throw r;
        return r;
      },
    },
  } as unknown as Anthropic;
}
const edits = (list: unknown[]) =>
  ({ content: [{ type: "tool_use", id: "c", name: "emit_graph_edits", input: { edits: list } }] }) as unknown as Anthropic.Message;

describe("reviewGraph", () => {
  it("is skipped, with no call, when the graph has nothing to review — a CDN alone is not enough", async () => {
    const seen: { tool: string; content: string }[] = [];
    const out = await reviewGraph([comps[0]!, comps[2]!], [e("gw", "svc")], { newComponentIds: [], request: "" }, { client: fakeClient([], seen) });
    expect(out).toEqual({ edges: [e("gw", "svc")], reviewed: false, edits: [] });
    const withCdn = await reviewGraph([comps[0]!, comps[2]!, comps[3]!], [e("gw", "svc"), e("cdn", "svc")], { newComponentIds: [], request: "" }, { client: fakeClient([], seen) });
    expect(withCdn.reviewed).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("applies the AI's edits, and tells it which balancers are new and what the user asked", async () => {
    const seen: { tool: string; content: string }[] = [];
    const out = await reviewGraph(comps, edges, { newComponentIds: ["lb"], request: "Add a load balancer in front of the service." }, {
      client: fakeClient([edits([edit("remove", "gw", "svc")])], seen),
    });
    expect(out.reviewed).toBe(true);
    expect(out.edges).not.toContainEqual(e("gw", "svc"));
    expect(seen[0]!.content).toContain("newComponentIds");
    expect(seen[0]!.content).toContain("Add a load balancer in front of the service.");
  });

  it("an empty list of edits is a completed review that changed nothing", async () => {
    const out = await reviewGraph(comps, edges, { newComponentIds: [], request: "" }, { client: fakeClient([edits([])]) });
    expect(out).toMatchObject({ edges, reviewed: true, edits: [] });
  });

  it("an invalid answer is repaired once with the reason, and the corrected one applied", async () => {
    const out = await reviewGraph(comps, edges, { newComponentIds: [], request: "" }, {
      client: fakeClient([edits([edit("remove", "svc", "cdn")]), edits([edit("remove", "gw", "svc")])]),
    });
    expect(out.reviewed).toBe(true);
    expect(out.edges).not.toContainEqual(e("gw", "svc"));
  });

  it("never fails the caller: an API error or a persistently invalid answer comes back as not reviewed", async () => {
    const failed = await reviewGraph(comps, edges, { newComponentIds: [], request: "" }, { client: fakeClient([new Error("boom")]) });
    expect(failed).toEqual({ edges, reviewed: false, edits: [] });
    const invalid = await reviewGraph(comps, edges, { newComponentIds: [], request: "" }, {
      client: fakeClient([edits([edit("remove", "svc", "cdn")]), edits([edit("remove", "svc", "cdn")])]),
    });
    expect(invalid.reviewed).toBe(false);
    expect(invalid.edges).toEqual(edges);
  });

  it("uses the main model, not the small utility one (which misread edge direction in a live run)", async () => {
    let model = "";
    const client = {
      messages: { create: async (p: { model: string }) => { model = p.model; return edits([]); } },
    } as unknown as Anthropic;
    await reviewGraph(comps, edges, { newComponentIds: [], request: "" }, { client });
    expect(model).not.toMatch(/haiku/i);
  });

  it("rejects an edit that would point an edge INTO a CDN (the live mistake: reversing the CDN's correct edge to its origin)", () => {
    const correct = [e("gw", "svc"), e("cdn", "svc")];
    expect(applyGraphEdits(comps, correct, [edit("reverse", "cdn", "svc")]).problem).toMatch(/INTO a CDN is backwards/);
  });

  it("still allows reversing an edge that already points into a CDN (fixing the real mistake)", () => {
    const backwards = [e("gw", "svc"), e("svc", "cdn")];
    expect(applyGraphEdits(comps, backwards, [edit("reverse", "svc", "cdn")]).problem).toBeNull();
  });

  it("the prompt says a balancer's edge to what it balances is correct, and leaves CDN edges alone (the model misread them live)", async () => {
    let system = "";
    const client = {
      messages: { create: async (p: { system: { text: string }[] }) => { system = p.system.map((b) => b.text).join(""); return edits([]); } },
    } as unknown as Anthropic;
    await reviewGraph(comps, edges, { newComponentIds: [], request: "" }, { client });
    expect(system).toMatch(/an edge from a load balancer TO the component it balances is CORRECT/);
    expect(system).toMatch(/Leave every CDN edge exactly as it is/);
  });
});

describe("the review replaces the hard-coded rewrites when it works, and they remain the fallback", () => {
  const lb = {
    id: "lb1", label: "Load balancer", kind: "load-balancer",
    instanceCount: { value: "single", provenance: "default", rationale: "One balancer at launch scale." },
    hasHealthChecks: { value: false, provenance: "default", rationale: "No health checks described." },
  };
  const validRework = {
    id: "checkout", name: "Checkout / order placement", workload: {},
    components: [
      { id: "gw", label: "API Gateway", kind: "gateway", hasRateLimiting: { rationale: "Already rate-limited.", provenance: "stated", value: true } },
      { id: "svc", label: "Order service", kind: "service", instanceCount: { rationale: "Eight instances.", provenance: "stated", value: "multiple" }, hasCircuitBreaker: { rationale: "Added a breaker on reconsideration.", provenance: "inferred", value: true } },
      { id: "db", label: "PostgreSQL (primary)", kind: "database", instanceCount: { rationale: "Two replicas.", provenance: "stated", value: "has-replicas" }, writeVolume: { rationale: "Order inserts dominate.", provenance: "stated", value: "high" } },
    ],
    edges: [e("gw", "svc"), e("svc", "db")],
  };
  const tool = (name: string, input: unknown) => ({ content: [{ type: "tool_use", id: "x", name, input }] }) as unknown as Anthropic.Message;
  const revise = tool("emit_extended_components", { keep: [], remove: [], components: [lb], edges: [e("gw", "lb1"), e("lb1", "svc")] });
  const asked = [{ request: "add a load balancer in front of the order service", instruction: "Add a load balancer in front of svc." }];

  it("Re-simulate: when the review succeeds its edits decide (here it removes the direct edge), and the request text reached it", async () => {
    const seen: { tool: string; content: string }[] = [];
    const client = fakeClient([tool("emit_system_model", validRework), revise, edits([edit("remove", "gw", "svc")])], seen);
    const result = await reworkModel(checkout, [], asked, { client });
    expect(result.model.edges).not.toContainEqual(e("gw", "svc"));
    expect(seen.find((s) => s.tool === "emit_graph_edits")!.content).toContain("Add a load balancer in front of svc.");
  });

  it("Re-simulate: a review that decides to LEAVE the direct edge is respected — the deterministic rewrite does not override it", async () => {
    const client = fakeClient([tool("emit_system_model", validRework), revise, edits([])]);
    const result = await reworkModel(checkout, [], asked, { client });
    expect(result.model.edges).toContainEqual(e("gw", "svc"));
  });

  it("Re-simulate: when the review fails, the deterministic rewrite still removes the direct edge for the new balancer", async () => {
    const client = fakeClient([tool("emit_system_model", validRework), revise, new Error("boom")]);
    const result = await reworkModel(checkout, [], asked, { client });
    expect(result.model.edges).not.toContainEqual(e("gw", "svc"));
    expect(result.model.edges).toContainEqual(e("gw", "lb1"));
  });

  it("build: the same holds for fromProse (review decides; fallback rewrites otherwise)", async () => {
    const workloadInput = { users: { included: true, tier: 100, target: 100 }, requests: { included: false, tier: 1000, target: 1000 } };
    const build = (review: Anthropic.Message | Error) => {
      const responses = new Map<string, Anthropic.Message | Error>([
        ["emit_system_model", tool("emit_system_model", { ...validRework, id: "toy", name: "Toy" })],
        ["emit_workload_parameters", tool("emit_workload_parameters", workloadInput)],
        ["emit_extended_components", tool("emit_extended_components", { components: [lb], edges: [e("gw", "lb1"), e("lb1", "svc")] })],
        ["emit_graph_edits", review],
      ]);
      return { messages: { create: async (p: { tools?: { name: string }[] }) => { const r = responses.get(p.tools?.[0]?.name ?? ""); if (!r) throw new Error("unexpected tool"); if (r instanceof Error) throw r; return r; } } } as unknown as Anthropic;
    };
    const reviewed = await fromProse("a toy system", { client: build(edits([edit("remove", "gw", "svc")])) });
    expect(reviewed.model.edges).not.toContainEqual(e("gw", "svc"));
    const untouched = await fromProse("a toy system", { client: build(edits([])) });
    expect(untouched.model.edges).toContainEqual(e("gw", "svc"));
    const fallback = await fromProse("a toy system", { client: build(new Error("boom")) });
    expect(fallback.model.edges).not.toContainEqual(e("gw", "svc"));
  });
});
