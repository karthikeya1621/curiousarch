import type { SystemModel } from "@archsim/engine";

/**
 * The shape of the model an AI call was made against — what tells you WHY a
 * call was big or expensive (component count and workload tier drive prompt
 * size and output length), copied onto every usage row for that request.
 */
export function describeModel(model: SystemModel): Record<string, unknown> {
  return {
    components: model.components.length,
    edges: model.edges.length,
    usersTier: model.workload.users?.tier ?? null,
    requestsTier: model.workload.requests?.tier ?? null,
  };
}
