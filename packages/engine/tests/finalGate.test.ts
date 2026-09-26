import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { checkFinalModel, ModelGateError } from "../src/inference/finalGate.js";
import { fromProse } from "../src/inference/fromProse.js";
import { reworkModel } from "../src/inference/reworkModel.js";
import { checkout } from "../models/reference.js";
import type { SystemModel } from "../src/types.js";

const trait = (value: unknown, provenance = "default") => ({ value, provenance, rationale: "Because." });
const comp = (id: string, kind: string, extra: object = {}) => ({ id, kind, label: id.toUpperCase(), ...extra });
const model = (components: object[], edges: [string, string][], over: Partial<SystemModel> = {}): SystemModel =>
  ({ id: "m", name: "My system", workload: { users: { included: true, tier: 100, target: 100 } }, components, edges: edges.map(([from, to]) => ({ from, to })), ...over }) as unknown as SystemModel;
const sound = () => model([comp("gw", "gateway", { hasRateLimiting: trait(false) }), comp("svc", "service", { instanceCount: trait("single") })], [["gw", "svc"]]);

describe("checkFinalModel: a sound model has no violations", () => {
  it("passes a plain model, and the same model against itself", () => {
    expect(checkFinalModel(sound(), { anythingAsked: false })).toEqual([]);
    expect(checkFinalModel(sound(), { previous: sound(), anythingAsked: false })).toEqual([]);
  });
});

describe("checkFinalModel: structure and identity", () => {
  it.each([
    ["a title that is JSON", { name: '{"value":"X"}' }, /contains JSON/],
    ["a changed title (with a previous model)", { name: "Another name" }, /id or title was changed/],
  ])("flags %s", (_label, over, re) => {
    expect(checkFinalModel({ ...sound(), ...over } as SystemModel, { previous: sound(), anythingAsked: false }).join("|")).toMatch(re);
  });

  it("flags duplicate ids, dangling / duplicate / self connections, a cycle and a floating component", () => {
    const dup = model([comp("a", "service"), comp("a", "service")], []);
    expect(checkFinalModel(dup, { anythingAsked: false }).join("|")).toMatch(/share an id/);
    const edges = model([comp("a", "service"), comp("b", "service")], [["a", "b"], ["a", "b"], ["a", "ghost"], ["b", "b"]]);
    const text = checkFinalModel(edges, { anythingAsked: false }).join("|");
    expect(text).toMatch(/appears twice/);
    expect(text).toMatch(/does not exist/);
    expect(text).toMatch(/connected to itself/);
    expect(checkFinalModel(model([comp("a", "service"), comp("b", "service")], [["a", "b"], ["b", "a"]]), { anythingAsked: false }).join("|")).toMatch(/cycle/);
    expect(checkFinalModel(model([comp("a", "service"), comp("b", "service"), comp("lone", "cache")], [["a", "b"]]), { anythingAsked: false }).join("|")).toMatch(/lone is not connected to anything/);
  });

  it("flags too many components of either group", () => {
    const many = model(Array.from({ length: 16 }, (_, i) => comp(`s${i}`, "service")), Array.from({ length: 15 }, (_, i) => [`s${i}`, `s${i + 1}`] as [string, string]));
    expect(checkFinalModel(many, { anythingAsked: false }).join("|")).toMatch(/more than 15 base/);
    const ext = model([comp("g", "gateway"), ...Array.from({ length: 7 }, (_, i) => comp(`c${i}`, "cdn"))], Array.from({ length: 7 }, (_, i) => [`c${i}`, "g"] as [string, string]));
    expect(checkFinalModel(ext, { anythingAsked: false }).join("|")).toMatch(/more than 6 extended/);
  });

  it("flags an edge INTO a CDN", () => {
    expect(checkFinalModel(model([comp("svc", "service"), comp("cdn", "cdn")], [["svc", "cdn"]]), { anythingAsked: false }).join("|")).toMatch(/cdn is drawn behind/);
  });
});

describe("checkFinalModel: minimal at the lowest tier", () => {
  it("flags a protection that is on without being stated, and allows a stated one", () => {
    const on = (prov: string) => model([comp("gw", "gateway", { hasRateLimiting: trait(true, prov) }), comp("svc", "service")], [["gw", "svc"]]);
    expect(checkFinalModel(on("inferred"), { anythingAsked: false }).join("|")).toMatch(/gw.hasRateLimiting is on although nothing states it/);
    expect(checkFinalModel(on("stated"), { anythingAsked: false })).toEqual([]);
  });

  it("flags scaling beyond the minimum with nothing asked, but not when a request is queued or above the lowest tier", () => {
    const scaled = model([comp("gw", "gateway"), comp("svc", "service", { instanceCount: trait("multiple", "inferred") })], [["gw", "svc"]]);
    expect(checkFinalModel(scaled, { anythingAsked: false }).join("|")).toMatch(/scaled beyond the minimum/);
    expect(checkFinalModel(scaled, { anythingAsked: true })).toEqual([]);
    expect(checkFinalModel({ ...scaled, workload: { users: { included: true, tier: 10_000, target: 10_000 } } }, { anythingAsked: false })).toEqual([]);
  });
});

describe("checkFinalModel: against the model it replaces", () => {
  const before = () => model([comp("gw", "gateway", { hasRateLimiting: trait(true, "stated") }), comp("svc", "service"), comp("db", "database")], [["gw", "svc"], ["svc", "db"]]);

  it("flags a removed component and a lost connection when nothing was asked, and stands down when something was", () => {
    const after = model([comp("gw", "gateway", { hasRateLimiting: trait(true, "stated") }), comp("svc", "service")], [["gw", "svc"]]);
    const text = checkFinalModel(after, { previous: before(), anythingAsked: false }).join("|");
    expect(text).toMatch(/db was removed although nothing asked/);
    expect(checkFinalModel(after, { previous: before(), anythingAsked: true })).toEqual([]);
    const cut = model([comp("gw", "gateway", { hasRateLimiting: trait(true, "stated") }), comp("svc", "service"), comp("db", "database")], [["gw", "svc"]]);
    expect(checkFinalModel(cut, { previous: before(), anythingAsked: false }).join("|")).toMatch(/svc -> db was lost/);
  });

  it("accepts a connection that survives as a path through a new component", () => {
    const via = model([comp("gw", "gateway", { hasRateLimiting: trait(true, "stated") }), comp("svc", "service"), comp("q", "queue"), comp("db", "database")], [["gw", "svc"], ["svc", "q"], ["q", "db"]]);
    expect(checkFinalModel(via, { previous: before(), anythingAsked: false })).toEqual([]);
  });

  it("flags a stated value that changed and a changed workload", () => {
    const off = model([comp("gw", "gateway", { hasRateLimiting: trait(false, "inferred") }), comp("svc", "service"), comp("db", "database")], [["gw", "svc"], ["svc", "db"]]);
    expect(checkFinalModel(off, { previous: before(), anythingAsked: false }).join("|")).toMatch(/gw.hasRateLimiting was stated by the description and changed/);
    const moved = { ...before(), workload: { users: { included: true, tier: 10_000, target: 10_000 } } } as SystemModel;
    expect(checkFinalModel(moved, { previous: before(), anythingAsked: false }).join("|")).toMatch(/workload settings were changed/);
  });

  it("does not count turning a backwards CDN edge around as a lost connection", () => {
    const old = model([comp("svc", "service"), comp("cdn", "cdn")], [["svc", "cdn"]]);
    const fixed = model([comp("svc", "service"), comp("cdn", "cdn")], [["cdn", "svc"]]);
    expect(checkFinalModel(fixed, { previous: old, anythingAsked: false })).toEqual([]);
  });
});

describe("ModelGateError", () => {
  it("carries the violations and a readable message", () => {
    const e = new ModelGateError(["a", "b"]);
    expect(e.name).toBe("ModelGateError");
    expect(e.violations).toEqual(["a", "b"]);
    expect(e.message).toMatch(/broke 2 rules: a; b/);
  });
});

function tool(name: string, input: unknown): Anthropic.Message {
  return { content: [{ type: "tool_use", id: "c", name, input }] } as unknown as Anthropic.Message;
}
const svcTrait = (value: string) => ({ rationale: "Set for the scale.", provenance: "inferred", value });
const topology = (svcCount: string) => ({
  id: "toy", name: "Toy", workload: {},
  components: [
    { id: "gw", label: "Gateway", kind: "gateway", hasRateLimiting: { rationale: "Not part of the described system.", provenance: "default", value: false } },
    { id: "svc", label: "Service", kind: "service", instanceCount: svcTrait(svcCount), hasCircuitBreaker: { rationale: "Not part of the described system.", provenance: "default", value: false } },
  ],
  edges: [{ from: "gw", to: "svc" }],
});
const workloadInput = { users: { included: true, tier: 100, target: 100 }, requests: { included: false, tier: 1000, target: 1000 } };

describe("fromProse runs the final gate", () => {
  const client = (topologies: unknown[], seen: string[] = []) => {
    let n = 0;
    return {
      messages: {
        create: async (p: { tools?: { name: string }[]; messages: { content: unknown }[] }) => {
          const name = p.tools?.[0]?.name ?? "";
          if (name === "emit_workload_parameters") return tool(name, workloadInput);
          if (name === "emit_extended_components") return tool(name, { components: [], edges: [] });
          if (name === "emit_coverage") return tool(name, { parts: [] });
          seen.push(JSON.stringify(p.messages[0]!.content));
          const next = topologies[n++];
          if (!next) throw new Error("no more topology responses");
          return tool("emit_system_model", next);
        },
      },
    } as unknown as Anthropic;
  };

  it("a build that breaks a rule is tried again with the violation named, and the second attempt is used", async () => {
    const seen: string[] = [];
    const result = await fromProse("a toy system", { client: client([topology("multiple"), topology("single")], seen) });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain("broke these rules");
    expect(seen[1]).toContain("scaled beyond the minimum");
    const svc = result.model.components.find((c) => c.id === "svc") as unknown as { instanceCount: { value: string } };
    expect(svc.instanceCount.value).toBe("single");
    expect(result.repaired).toBe(true);
  });

  it("a build that breaks a rule twice throws ModelGateError instead of returning it", async () => {
    await expect(fromProse("a toy system", { client: client([topology("multiple"), topology("multiple")]) })).rejects.toBeInstanceOf(ModelGateError);
  });

  it("a sound build makes no extra call", async () => {
    const seen: string[] = [];
    await fromProse("a toy system", { client: client([topology("single")], seen) });
    expect(seen).toHaveLength(1);
  });
});

describe("reworkModel runs the final gate", () => {
  const empty = () => tool("emit_extended_components", { keep: [], remove: [], components: [], edges: [] });
  const base = (extra: object[] = [], edges: object[] = []) => ({
    id: "checkout", name: "Checkout / order placement", workload: {},
    components: [...checkout.components, ...extra],
    edges: [...checkout.edges, ...edges],
  });
  const responder = (queue: Anthropic.Message[]) => {
    let n = 0;
    return { messages: { create: async () => { const r = queue[n++]; if (!r) throw new Error("no more canned responses"); return r; } } } as unknown as Anthropic;
  };
  // A violation no single step catches: the extended step adds a component and wires it to nothing.
  const cdn = {
    id: "cdn9", label: "CDN", kind: "cdn",
    hasOriginShield: { rationale: "Not part of the described system.", provenance: "default", value: false },
  };
  const revise = (edges: object[]) => tool("emit_extended_components", { keep: [], remove: [], components: [cdn], edges });
  const ask = [{ request: "add a CDN", instruction: "Add a cdn." }];

  it("a rework whose merged result leaves a new component connected to nothing is tried again, and a clean second attempt is returned", async () => {
    const client = responder([tool("emit_system_model", base()), revise([]), tool("emit_system_model", base()), revise([{ from: "cdn9", to: "svc" }])]);
    const result = await reworkModel(checkout, [], ask, { client });
    expect(result.model.edges).toContainEqual({ from: "cdn9", to: "svc" });
    expect(result.repaired).toBe(true);
  });

  it("two bad attempts throw ModelGateError and nothing is returned", async () => {
    const client = responder([tool("emit_system_model", base()), revise([]), tool("emit_system_model", base()), revise([])]);
    await expect(reworkModel(checkout, [], ask, { client })).rejects.toBeInstanceOf(ModelGateError);
  });

  it("a sound rework makes no extra pass", async () => {
    const client = responder([tool("emit_system_model", base()), empty()]);
    expect((await reworkModel(checkout, [], [], { client })).repaired).toBe(false);
  });
});
