"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
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
import { ResimulateNotes } from "./ResimulateNotes";

const nodeTypes = { component: ComponentNode, traffic: TrafficNode };

// Hard floor — never let interactive zoom-out go further than this,
// regardless of how large the diagram is. Matches the fixed value this
// used to be outright before the limit became dynamic per-diagram.
const MIN_ZOOM_FLOOR = 0.1;
// Never RESTRICT zoom-out more than this either, even for a tiny 2-node
// system — matches React Flow's own default, so a small diagram doesn't
// feel artificially locked in tight.
const MIN_ZOOM_CEILING = 0.5;

/**
 * The zoom-out floor scales with the actual laid-out diagram, not a fixed
 * constant — a small system gets a tighter (more legible) limit, a large
 * one gets enough room to still fit without clipping. `getViewportForBounds`
 * is the same "what zoom fits these nodes in this container" math
 * `fitView` uses internally; calling it directly here (without applying
 * the result) lets the interactive zoom LIMIT track what fitView would
 * actually need, instead of a number picked once and left alone
 * regardless of how big systems got since (this used to be a flat 0.1,
 * chosen back when a "large" system was 4-6 components — now up to 21).
 */
function computeMinZoom(diagramNodes: Node[], container: HTMLElement): number {
  if (diagramNodes.length === 0 || container.clientWidth === 0 || container.clientHeight === 0) {
    return MIN_ZOOM_FLOOR;
  }
  const bounds = getNodesBounds(diagramNodes);
  const { zoom } = getViewportForBounds(bounds, container.clientWidth, container.clientHeight, MIN_ZOOM_FLOOR, 2, 0.15);
  return Math.min(MIN_ZOOM_CEILING, Math.max(MIN_ZOOM_FLOOR, zoom));
}

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
  const [minZoom, setMinZoom] = useState(MIN_ZOOM_FLOOR);
  // The resize effect below only subscribes once ([fitView] deps, not
  // re-created on every node change) — a ref is what lets its handler see
  // the CURRENT laid-out nodes without needing to resubscribe the
  // ResizeObserver on every layout.
  const nodesRef = useRef<Node[]>([]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // `fitView()` above only runs after a model/layout change — never when
  // the CONTAINER itself resizes (a column width change, the sidebar
  // collapsing, a browser resize). Without this, the diagram keeps
  // whatever zoom/pan it first computed and just leaves the freed-up
  // space blank instead of using it. Debounced so a drag-resize doesn't
  // call fitView on every intermediate frame. Also recomputes `minZoom`
  // (see computeMinZoom's own comment) — a container resize changes what
  // zoom level the same diagram actually needs to fit, same as a topology
  // change does.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    let timeout: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const nextMinZoom = computeMinZoom(nodesRef.current, el);
        setMinZoom(nextMinZoom);
        fitView({ duration: 200, padding: 0.15, minZoom: nextMinZoom });
      }, 150);
    });
    observer.observe(el);
    return () => {
      clearTimeout(timeout);
      observer.disconnect();
    };
  }, [fitView]);

  // Findings are decoration on the nodes, not part of the layout: a
  // findings refresh used to re-run the whole ELK layout (and fitView,
  // which snaps the user's pan/zoom back) because `findingsByComponent`
  // was a dependency of the layout effect below — so every Build laid the
  // diagram out twice, once for the model and again when findings
  // arrived. Kept in a ref so the layout effect can read the latest
  // without depending on it, and applied by `withFindings`, which both the
  // layout/animation and the cheap effect after it share.
  const findingsRef = useRef(findingsByComponent);
  useEffect(() => {
    findingsRef.current = findingsByComponent;
  }, [findingsByComponent]);

  const withFindings = useCallback(
    (ns: Node[]): Node[] =>
      ns.map((n) =>
        n.id === TRAFFIC_NODE_ID ? n : { ...n, data: { ...n.data, findings: findingsRef.current.get(n.id) ?? [] } },
      ),
    [],
  );

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

      // Computed from THIS layout, not read from state — state wouldn't
      // update in time for the fitView call a few lines down in this same
      // pass, so the freshly-computed value is used directly for both.
      const nextMinZoom = wrapperRef.current ? computeMinZoom(laidOut, wrapperRef.current) : MIN_ZOOM_FLOOR;
      setMinZoom(nextMinZoom);

      if (isFirstLayout.current) {
        setNodes(withFindings(laidOut));
        isFirstLayout.current = false;
        requestAnimationFrame(() => fitView({ duration: 0, padding: 0.15, minZoom: nextMinZoom }));
      } else {
        // Decorated per frame, not once up front: findings can change
        // during the ~300ms animation, and a frame built from stale data
        // would overwrite the effect below's update.
        animateNodes(laidOut, previousPositions.current, (ns) => setNodes(withFindings(ns)), () =>
          fitView({ duration: 200, padding: 0.15, minZoom: nextMinZoom }),
        );
      }
      for (const n of laidOut) previousPositions.current.set(n.id, n.position);
      setEdges(laidOutEdges);
    });
    return () => {
      cancelled = true;
    };
  }, [components, modelEdges, withFindings, setNodes, setEdges, fitView]);

  // Findings changed, topology didn't: just update the badge data in
  // place — no relayout, no animation, no viewport change.
  useEffect(() => {
    setNodes((ns) => withFindings(ns));
  }, [findingsByComponent, withFindings, setNodes]);

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
        // Dynamic, not a flat constant — see computeMinZoom's own comment.
        // Originally a flat 0.1: React Flow's own default (0.5) can't fit
        // a realistic 4+ node system in this card's width, and fitView
        // would silently clip the rightmost node(s) instead of zooming out
        // further (found live via a UI review pass over screenshots).
        // 0.1 fixed that but never tightened back up for a small system.
        minZoom={minZoom}
      >
        {/* `var(--rf-bg-line)` (globals.css), not a hardcoded hex — this
            prop is a plain JS value React Flow feeds straight into an SVG
            pattern fill, so it can't take a `dark:` Tailwind class the
            way everything else here does; reading the CSS variable is
            what lets it still follow the `.dark` class switch. */}
        <Background variant={BackgroundVariant.Lines} color="var(--rf-bg-line)" gap={24} lineWidth={1} />
      </ReactFlow>
      {showResimulate && (
        // Purely a positioning wrapper — no background of its own, so the
        // button's white/90 pill and ResimulateNotes' amber box stay two
        // visually distinct floating elements, not one merged container.
        <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5">
          <div className="rounded-lg bg-white/90 p-1.5 shadow-sm backdrop-blur-sm dark:bg-slate-800/90">
            <ResimulateButton model={model} />
          </div>
          <ResimulateNotes />
        </div>
      )}
    </div>
  );
}
