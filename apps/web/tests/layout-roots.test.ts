import { describe, expect, it } from "vitest";
import { layoutModel, TRAFFIC_NODE_ID } from "../lib/layout";

const comp = (id: string, kind: string) => ({ id, kind, label: id });

describe("layoutModel: which components the Traffic node feeds", () => {
  it("feeds every component nothing points at — so a CDN in front of its origin sits next to the gateway", async () => {
    const model = {
      id: "m",
      name: "m",
      workload: {},
      components: [comp("gw", "gateway"), comp("live", "service"), comp("cdn", "cdn")],
      edges: [{ from: "gw", to: "live" }, { from: "cdn", to: "live" }],
    };
    const { edges } = await layoutModel(model as never);
    const fed = edges.filter((e) => e.source === TRAFFIC_NODE_ID).map((e) => e.target).sort();
    expect(fed).toEqual(["cdn", "gw"]);
  });

  it("does not feed a CDN drawn behind its origin (the direction the lint flags)", async () => {
    const model = {
      id: "m",
      name: "m",
      workload: {},
      components: [comp("gw", "gateway"), comp("live", "service"), comp("cdn", "cdn")],
      edges: [{ from: "gw", to: "live" }, { from: "live", to: "cdn" }],
    };
    const { edges } = await layoutModel(model as never);
    expect(edges.filter((e) => e.source === TRAFFIC_NODE_ID).map((e) => e.target)).toEqual(["gw"]);
  });
});
