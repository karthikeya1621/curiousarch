"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AiFinding, SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { layoutModel, TRAFFIC_NODE_ID } from "../lib/layout";
import { animateNodes } from "../lib/animateNodes";
import { ComponentNode } from "./ComponentNode";
import { TrafficNode } from "./TrafficNode";

const nodeTypes = { component: ComponentNode, traffic: TrafficNode };

export function FlowDiagram({
  model,
  findingsOverride,
}: {
  model: SystemModel;
  findingsOverride?: AiFinding[];
}) {
  return (
    <ReactFlowProvider>
      <FlowDiagramInner model={model} findingsOverride={findingsOverride} />
    </ReactFlowProvider>
  );
}

function FlowDiagramInner({
  model,
  findingsOverride,
}: {
  model: SystemModel;
  findingsOverride?: AiFinding[];
}) {
  const { fitView } = useReactFlow();
  const liveFindings = useAppStore((s) => s.findings);
  const findings = findingsOverride ?? liveFindings;

  const findingsByComponent = useMemo(() => {
    const map = new Map<string, AiFinding[]>();
    for (const f of findings) {
      map.set(f.componentId, [...(map.get(f.componentId) ?? []), f]);
    }
    return map;
  }, [findings]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  // Not wired to <ReactFlow onEdgesChange>: React Flow processes edges
  // against an internal node lookup that lags one tick behind a fresh
  // `nodes` prop on a topology change, and dispatches a "remove" change for
  // any edge whose source/target it can't find yet — permanently deleting
  // it from state even though the node arrives moments later in the same
  // render pass. We own `edges` outright (nothing here lets a user drag or
  // delete an edge), so simply never routing removal changes back into
  // `setEdges` sidesteps it. Confirmed live: wiring onEdgesChange dropped
  // every edge referencing a component not present in the previous model
  // on every reference-model switch.
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const previousPositions = useRef(new Map<string, { x: number; y: number }>());
  const isFirstLayout = useRef(true);

  useEffect(() => {
    let cancelled = false;
    layoutModel(model).then(({ nodes: laidOut, edges: laidOutEdges }) => {
      if (cancelled) return;

      const withData = laidOut.map((n) => ({
        ...n,
        data:
          n.id === TRAFFIC_NODE_ID
            ? n.data
            : { ...n.data, findings: findingsByComponent.get(n.id) ?? [] },
      }));

      if (isFirstLayout.current) {
        setNodes(withData);
        isFirstLayout.current = false;
        requestAnimationFrame(() => fitView({ duration: 0, padding: 0.15, minZoom: 0.1 }));
      } else {
        animateNodes(withData, previousPositions.current, setNodes, () =>
          fitView({ duration: 200, padding: 0.15, minZoom: 0.1 }),
        );
      }
      for (const n of laidOut) previousPositions.current.set(n.id, n.position);
      setEdges(laidOutEdges);
    });
    return () => {
      cancelled = true;
    };
  }, [model, findingsByComponent, setNodes, setEdges, fitView]);

  return (
    <div
      style={{ height: 440 }}
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
        // Default minZoom (0.5) can't fit a realistic 4+ node system in
        // this card's width — fitView silently clips the rightmost node(s)
        // instead of zooming out further. Found live via a UI review pass
        // over screenshots: nearly every "built" screenshot had a node
        // truncated at the card edge.
        minZoom={0.1}
      >
        <Background color="#cbd5e1" gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}
