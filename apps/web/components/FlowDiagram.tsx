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
import type { Scenario, SystemModel } from "@archsim/engine";
import { useScenarios } from "../lib/hooks";
import { scenarioComponentId } from "../lib/scenarioComponentId";
import { layoutModel, TRAFFIC_NODE_ID } from "../lib/layout";
import { animateNodes } from "../lib/animateNodes";
import { ComponentNode } from "./ComponentNode";
import { TrafficNode } from "./TrafficNode";

const nodeTypes = { component: ComponentNode, traffic: TrafficNode };

export function FlowDiagram({ model }: { model: SystemModel }) {
  return (
    <ReactFlowProvider>
      <FlowDiagramInner model={model} />
    </ReactFlowProvider>
  );
}

function FlowDiagramInner({ model }: { model: SystemModel }) {
  const { fitView } = useReactFlow();
  const scenarios = useScenarios(model);

  const scenariosByNode = useMemo(() => {
    const map = new Map<string, Scenario[]>();
    for (const s of scenarios) {
      const id = scenarioComponentId(s) ?? TRAFFIC_NODE_ID;
      map.set(id, [...(map.get(id) ?? []), s]);
    }
    return map;
  }, [scenarios]);

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
        data: { ...n.data, scenarios: scenariosByNode.get(n.id) ?? [] },
      }));

      if (isFirstLayout.current) {
        setNodes(withData);
        isFirstLayout.current = false;
        requestAnimationFrame(() => fitView({ duration: 0 }));
      } else {
        animateNodes(withData, previousPositions.current, setNodes, () =>
          fitView({ duration: 200 }),
        );
      }
      for (const n of laidOut) previousPositions.current.set(n.id, n.position);
      setEdges(laidOutEdges);
    });
    return () => {
      cancelled = true;
    };
  }, [model, scenariosByNode, setNodes, setEdges, fitView]);

  return (
    <div style={{ height: 440 }} className="rounded-lg border border-gray-200 bg-white">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
