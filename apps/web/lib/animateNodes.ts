import type { Node } from "@xyflow/react";

const DURATION_MS = 300;

/**
 * No library support exists for animating React Flow node positions across
 * a relayout — its controlled re-renders defeat CSS transitions. This is
 * the maintainer-suggested pattern instead: on every relayout, diff new
 * positions against the last known on-screen ones and run a linear rAF
 * interpolation, calling setNodes every frame. If this ever proves janky
 * or unstable, fall back to `setNodes(targetNodes)` (instant repositioning)
 * rather than sinking more time into it.
 *
 * The t=0 frame is applied synchronously (not deferred into the first
 * requestAnimationFrame callback) so that node identity/topology lands in
 * the same render as any edges referencing these ids. Deferring it left a
 * one-frame gap on a topology change (e.g. switching reference models)
 * where `edges` pointed at node ids `nodes` didn't have yet — React Flow
 * silently drops an edge whose source/target isn't in `nodes` at render
 * time, and it never recovered once inserted that way. Only the
 * interpolated *position* is deferred to the animation now, never which
 * nodes/edges exist.
 */
export function animateNodes(
  targetNodes: Node[],
  previousPositions: Map<string, { x: number; y: number }>,
  setNodes: (nodes: Node[]) => void,
  onComplete?: () => void,
): void {
  const startPositions = new Map(
    targetNodes.map((n) => [n.id, previousPositions.get(n.id) ?? n.position]),
  );

  function positionsAt(t: number): Node[] {
    return targetNodes.map((n) => {
      const from = startPositions.get(n.id)!;
      return {
        ...n,
        position: {
          x: from.x + (n.position.x - from.x) * t,
          y: from.y + (n.position.y - from.y) * t,
        },
      };
    });
  }

  setNodes(positionsAt(0));

  const start = performance.now();
  function frame(now: number) {
    const t = Math.min(1, (now - start) / DURATION_MS);
    setNodes(positionsAt(t));
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      onComplete?.();
    }
  }
  requestAnimationFrame(frame);
}
