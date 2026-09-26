import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import type Anthropic from "@anthropic-ai/sdk";
import { graphFacts } from "../src/inference/graphFacts.js";
import { buildFindingsToolInputSchema, checkAreasMatchFindings, identifyFailures, rankFindings, REVIEW_AREAS } from "../src/inference/identifyFailures.js";
import { checkout } from "../models/reference.js";

const c = (id: string, kind: string) => ({ id, kind, label: id.toUpperCase() });
const model = (components: object[], edges: [string, string][]) => ({ components, edges: edges.map(([from, to]) => ({ from, to })) }) as never;

describe("graphFacts — facts read off the structure, not judgments", () => {
  it("names a store several components share, and how a broker is wired", () => {
    const facts = graphFacts(
      model(
        [c("a", "service"), c("b", "service"), c("db", "database"), c("bus", "message-broker"), c("sub", "service")],
        [["a", "db"], ["b", "db"], ["a", "bus"], ["bus", "sub"]],
      ),
    );
    expect(facts).toContain('database "DB" is used by 2 components: A, B');
    expect(facts).toContain('message-broker "BUS": publishers/producers = A; consumers/subscribers = SUB.');
  });

  it("says a broker has no subscribers when it has none, and reports a component reached two ways", () => {
    const facts = graphFacts(model([c("a", "service"), c("q", "queue"), c("w", "service")], [["a", "q"], ["q", "w"], ["a", "w"]]));
    expect(facts).toContain('"A" reaches "W" both directly and through "Q"');
    expect(graphFacts(model([c("a", "service"), c("bus", "message-broker")], [["a", "bus"]]))).toContain("consumers/subscribers = none");
  });

  it("reports wide fan-out and who calls an external system, and 'nothing notable' for a plain graph", () => {
    const facts = graphFacts(
      model([c("g", "gateway"), c("s1", "service"), c("s2", "service"), c("s3", "service"), c("s4", "service"), c("pay", "external-dependency")], [["g", "s1"], ["g", "s2"], ["g", "s3"], ["g", "s4"], ["s1", "pay"]]),
    );
    expect(facts).toContain('gateway "G" calls 4 components directly');
    expect(facts).toContain('external system "PAY" is called by: S1');
    expect(graphFacts(model([c("a", "service"), c("b", "service")], [["a", "b"]]))).toBe("- (nothing notable)");
  });
});

describe("area decisions and ranking", () => {
  const decision = (area: string, applies: boolean) => ({ area, applies, evidence: applies ? "The diagram shows it." : "Not applicable." });
  const all = (applying: string[]) => REVIEW_AREAS.map((a) => decision(a, applying.includes(a)));
  const finding = (over: Record<string, unknown> = {}) => ({
    code: "X", severity: "warning", componentId: "svc", title: "t", explanation: "e", fixes: [{ id: "f", label: "Do a thing", tradeoff: "Costs something." }],
    bitesAt: "now", aboutInstanceCount: false, area: "other", impact: "medium", ...over,
  });

  it("checkAreasMatchFindings names a decided-but-empty area and an undecided-but-used one", () => {
    expect(checkAreasMatchFindings({ considered: all(["data-integrity"]) as never, findings: [finding({ area: "data-integrity" })] as never })).toBeNull();
    expect(checkAreasMatchFindings({ considered: all(["data-integrity"]) as never, findings: [] })).toMatch(/data-integrity applies but listed no finding/);
    expect(checkAreasMatchFindings({ considered: all([]) as never, findings: [finding({ area: "regional-latency" })] as never })).toMatch(/regional-latency without deciding it applies/);
    expect(checkAreasMatchFindings({ considered: all([]) as never, findings: [finding({ area: "other" })] as never })).toBeNull();
  });

  it("rankFindings orders by the AI's impact, then severity, keeping its own order for ties", () => {
    const list = [
      finding({ code: "A", impact: "low", severity: "critical" }),
      finding({ code: "B", impact: "high", severity: "warning" }),
      finding({ code: "C", impact: "high", severity: "critical" }),
      finding({ code: "D", impact: "medium", severity: "warning" }),
      finding({ code: "E", impact: "medium", severity: "warning" }),
    ] as never[];
    expect(rankFindings(list).map((f: { code: string }) => f.code)).toEqual(["C", "B", "D", "E", "A"]);
    expect(rankFindings([{ severity: "warning" }, { severity: "critical" }] as never).map((f: { severity: string }) => f.severity)).toEqual(["critical", "warning"]);
  });

  const respond = (responses: unknown[], seen?: string[]) => {
    let call = 0;
    return {
      messages: {
        create: async (p: { messages: { content: unknown }[] }) => {
          seen?.push(JSON.stringify(p.messages[0]!.content));
          const input = responses[call++];
          if (!input) throw new Error("no more canned responses");
          return { content: [{ type: "tool_use", id: "c", name: "emit_failures", input }] } as unknown as Anthropic.Message;
        },
      },
    } as unknown as Anthropic;
  };

  it("end to end: a decision that contradicts the findings is rejected with the reason and the corrected answer accepted", async () => {
    const client = respond([
      { considered: all(["data-integrity"]), findings: [] },
      { considered: all(["data-integrity"]), findings: [finding({ area: "data-integrity", componentId: "db", title: "Retries can double-charge" })] },
    ]);
    const found = await identifyFailures(checkout, { client });
    expect(found.map((f) => f.title)).toEqual(["Retries can double-charge"]);
  });

  it("returns the findings ranked most important first, and tells the AI the graph facts", async () => {
    const seen: string[] = [];
    const client = respond(
      [{ considered: all(["cascading-failure"]), findings: [finding({ code: "LOW", impact: "low", area: "cascading-failure" }), finding({ code: "HIGH", impact: "high", area: "cascading-failure" })] }],
      seen,
    );
    const found = await identifyFailures(checkout, { client });
    expect(found.map((f) => f.code)).toEqual(["HIGH", "LOW"]);
    expect(seen[0]).toContain("Facts from the diagram");
  });

  it("older canned answers with neither decisions nor ranking still work", async () => {
    const client = respond([{ findings: [{ ...finding(), area: undefined, impact: undefined }] }]);
    expect(await identifyFailures(checkout, { client })).toHaveLength(1);
  });

  it("the prompt defines all eight areas and says a finding in a non-applying area is a contradiction", async () => {
    let system = "";
    const client = { messages: { create: async (p: { system: { text: string }[] }) => { system = p.system.map((b) => b.text).join(""); return { content: [{ type: "tool_use", id: "c", name: "emit_failures", input: { considered: all([]), findings: [] } }] }; } } } as unknown as Anthropic;
    await identifyFailures(checkout, { client });
    for (const area of REVIEW_AREAS) expect(system).toContain(area);
    expect(system).toMatch(/A finding in an area you marked as not applying is a contradiction/);
  });

  it("the tool schema validates as JSON Schema 2020-12, requires considered and forbids extras", () => {
    const schema = buildFindingsToolInputSchema() as { required?: string[]; additionalProperties?: boolean };
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow();
    expect([...(schema.required ?? [])].sort()).toEqual(["considered", "findings"]);
    expect(schema.additionalProperties).toBe(false);
  });
});
