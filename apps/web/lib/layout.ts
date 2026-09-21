import type ELK from "elkjs/lib/elk.bundled.js";
import { isAsyncBoundary } from "@archsim/engine";
import type { Component, SystemModel } from "@archsim/engine";
import type { Edge, Node } from "@xyflow/react";

/** Only `components`/`edges` ever matter for a layout — narrower than `SystemModel` on purpose, so FlowDiagram.tsx's effect can depend on exactly these two fields (and correctly skip re-laying-out on a workload-only change, e.g. the tier slider) without needing to pass the whole model object through. */
type Topology = Pick<SystemModel, "components" | "edges">;

/**
 * Synthetic node representing the workload itself — not a real Component,
 * so it doesn't collide with any component id. Every component with no
 * incoming edge (in every reference model, just the gateway) gets an edge
 * from this node, giving the diagram a visible entry point and somewhere
 * to put workload-level scenarios (traffic spikes) that don't belong to
 * any one component.
 */
export const TRAFFIC_NODE_ID = "__traffic__";

export type ComponentNodeData = { component: Component };
export type TrafficNodeData = Record<string, never>;

/**
 * ELK is ~1.6 MB (the bundled build inlines its own worker), and nothing
 * needs it until a diagram is first drawn — a static import put it in the
 * main client bundle, so the login page and the blank canvas paid to
 * download and parse it too. Loaded on first use and reused after.
 */
let elkInstance: Promise<InstanceType<typeof ELK>> | undefined;
function getElk() {
  elkInstance ??= import("elkjs/lib/elk.bundled.js").then((m) => new m.default());
  return elkInstance;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 84;
const TRAFFIC_WIDTH = 120;
const TRAFFIC_HEIGHT = 56;

/**
 * Defensive, not just belt-and-suspenders — this runs on whatever's
 * actually in the database, including a project saved before the engine
 * itself started rejecting duplicate ids/edges (see
 * inference/extendedComponents.ts's own comment on that bug). React Flow
 * derives every node/edge key straight from a component's id or an
 * edge's endpoints, so a duplicate here isn't a cosmetic glitch — it's
 * the exact "two children with the same key" crash. Keeping the FIRST
 * occurrence of a given id/edge is an arbitrary but harmless choice, in
 * service of never crashing the diagram over already-saved bad data.
 */
function dedupeModel(model: Topology): Topology {
  const seenComponentIds = new Set<string>();
  const components = model.components.filter((c) => {
    if (seenComponentIds.has(c.id)) return false;
    seenComponentIds.add(c.id);
    return true;
  });

  const seenEdgeKeys = new Set<string>();
  const edges = model.edges.filter((e) => {
    const key = `${e.from}->${e.to}`;
    if (seenEdgeKeys.has(key) || !seenComponentIds.has(e.from) || !seenComponentIds.has(e.to)) return false;
    seenEdgeKeys.add(key);
    return true;
  });

  return { components, edges };
}

export async function layoutModel(
  rawTopology: Topology,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const model = dedupeModel(rawTopology);
  const targets = new Set(model.edges.map((e) => e.to));
  const roots = model.components.filter((c) => !targets.has(c.id));
  const componentById = new Map(model.components.map((c) => [c.id, c]));

  const elkEdges = [
    ...roots.map((r) => ({
      id: `${TRAFFIC_NODE_ID}->${r.id}`,
      sources: [TRAFFIC_NODE_ID],
      targets: [r.id],
    })),
    ...model.edges.map((e) => ({
      id: `${e.from}->${e.to}`,
      sources: [e.from],
      targets: [e.to],
    })),
  ];

  const elk = await getElk();
  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
    },
    children: [
      { id: TRAFFIC_NODE_ID, width: TRAFFIC_WIDTH, height: TRAFFIC_HEIGHT },
      ...model.components.map((c) => ({ id: c.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    ],
    edges: elkEdges,
  });

  const positionById = new Map(
    (graph.children ?? []).map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]),
  );

  const nodes: Node[] = [
    {
      id: TRAFFIC_NODE_ID,
      type: "traffic",
      position: positionById.get(TRAFFIC_NODE_ID) ?? { x: 0, y: 0 },
      data: {},
    },
    ...model.components.map((c) => ({
      id: c.id,
      type: "component",
      position: positionById.get(c.id) ?? { x: 0, y: 0 },
      data: { component: c } satisfies ComponentNodeData,
    })),
  ];

  const edges: Edge[] = [
    ...roots.map((r) => ({
      id: `${TRAFFIC_NODE_ID}->${r.id}`,
      source: TRAFFIC_NODE_ID,
      target: r.id,
    })),
    ...model.edges.map((e) => {
      const from = componentById.get(e.from);
      const async = from ? isAsyncBoundary(from) : false;
      return {
        id: `${e.from}->${e.to}`,
        source: e.from,
        target: e.to,
        ...(async ? { style: { strokeDasharray: "5,5" }, label: "async" } : {}),
      };
    }),
  ];

  return { nodes, edges };
}
