"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
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
import { ResimulateButton } from "./ResimulateButton";

const nodeTypes = { component: ComponentNode, traffic: TrafficNode };

export function FlowDiagram({
  model,
  findingsOverride,
  showResimulate,
}: {
  model: SystemModel;
  findingsOverride?: AiFinding[];
  /** Only the live (non-preview) diagram gets the floating Re-simulate control — resimulating a read-only past version has no clear meaning. */
  showResimulate?: boolean;
}) {
  return (
    <ReactFlowProvider>
      <FlowDiagramInner model={model} findingsOverride={findingsOverride} showResimulate={showResimulate} />
    </ReactFlowProvider>
  );
}

function FlowDiagramInner({
  model,
  findingsOverride,
  showResimulate,
}: {
  model: SystemModel;
  findingsOverride?: AiFinding[];
  showResimulate?: boolean;
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
  const wrapperRef = useRef<HTMLDivElement>(null);

  // `fitView()` above only runs after a model/layout change — never when
  // the CONTAINER itself resizes (a column width change, the sidebar
  // collapsing, a browser resize). Without this, the diagram keeps
  // whatever zoom/pan it first computed and just leaves the freed-up
  // space blank instead of using it. Debounced so a drag-resize doesn't
  // call fitView on every intermediate frame.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    let timeout: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fitView({ duration: 200, padding: 0.15, minZoom: 0.1 }), 150);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timeout);
      observer.disconnect();
    };
  }, [fitView]);

  // Deliberately depends on `model.components`/`model.edges`, not `model`
  // itself, and passes only those two fields to layoutModel — moving the
  // tier slider (setWorkloadTier) replaces `model` with a new object but
  // keeps `components`/`edges` referentially unchanged (only `workload`
  // differs), and a tier change alone shouldn't re-run the ELK layout or
  // animate nodes; the canvas should only actually redraw after an
  // explicit Re-simulate. TrafficNode.tsx reads `workload` straight from
  // the store itself, so its "100 users" caption still updates
  // immediately regardless of this effect not re-running.
  const { components, edges: modelEdges } = model;
  useEffect(() => {
    let cancelled = false;
    layoutModel({ components, edges: modelEdges }).then(({ nodes: laidOut, edges: laidOutEdges }) => {
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
  }, [components, modelEdges, findingsByComponent, setNodes, setEdges, fitView]);

  return (
    <div
      ref={wrapperRef}
      style={{ height: 440 }}
      className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"
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
        {/* `var(--rf-bg-line)` (globals.css), not a hardcoded hex — this
            prop is a plain JS value React Flow feeds straight into an SVG
            pattern fill, so it can't take a `dark:` Tailwind class the
            way everything else here does; reading the CSS variable is
            what lets it still follow the `.dark` class switch. */}
        <Background variant={BackgroundVariant.Lines} color="var(--rf-bg-line)" gap={24} lineWidth={1} />
      </ReactFlow>
      {showResimulate && (
        <div className="absolute right-3 top-3 z-10 rounded-lg bg-white/90 p-1.5 shadow-sm backdrop-blur-sm dark:bg-slate-800/90">
          <ResimulateButton model={model} />
        </div>
      )}
    </div>
  );
}
