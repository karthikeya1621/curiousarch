import { describe, expect, it } from "vitest";
import { healSession, type SavedSession } from "../lib/sessionStorage";

const model = (name: string, id = "search-v1") => ({ id, name, components: [], edges: [], workload: {} }) as never;

describe("healSession", () => {
  it("cleans a JSON-wrapped name and id in the working model, the baseline and every version", () => {
    const wrapped = model('{"value":"Google Search"}', '{"value": "search-v1"}');
    const healed = healSession({
      model: wrapped,
      baselineModel: wrapped,
      versions: [{ id: "v1", model: wrapped, findings: [], createdAt: 1 }, { id: "v2", model: model("Google Search"), findings: [], createdAt: 2 }],
    } as unknown as SavedSession);
    expect(healed.model.name).toBe("Google Search");
    expect(healed.model.id).toBe("search-v1");
    expect(healed.baselineModel?.name).toBe("Google Search");
    expect(healed.versions.map((v) => v.model.name)).toEqual(["Google Search", "Google Search"]);
  });

  it("tolerates a project saved without a baseline or versions", () => {
    const healed = healSession({ model: model("Plain") } as unknown as SavedSession);
    expect(healed.model.name).toBe("Plain");
    expect(healed.baselineModel).toBeUndefined();
    expect(healed.versions).toEqual([]);
  });
});
