import ELK from "elkjs/lib/elk.bundled.js";
import { isAsyncBoundary } from "@archsim/engine";
import type { Component, SystemModel } from "@archsim/engine";
import type { Edge, Node } from "@xyflow/react";

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

const elk = new ELK();

const NODE_WIDTH = 200;
const NODE_HEIGHT = 84;
const TRAFFIC_WIDTH = 120;
const TRAFFIC_HEIGHT = 56;

export async function layoutModel(
  model: SystemModel,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
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
