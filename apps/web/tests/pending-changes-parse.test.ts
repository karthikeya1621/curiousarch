import { describe, expect, it } from "vitest";
import { parsePendingChanges } from "../lib/limits";

describe("parsePendingChanges keeps the kinds the AI classified a change as touching", () => {
  it("passes a valid kinds list through, and leaves it off an entry that has none", () => {
    expect(
      parsePendingChanges([
        { request: "add an lb", instruction: "Add a load-balancer.", kinds: ["load-balancer"] },
        { request: "old", instruction: "Legacy change." },
      ]),
    ).toEqual([
      { request: "add an lb", instruction: "Add a load-balancer.", kinds: ["load-balancer"] },
      { request: "old", instruction: "Legacy change." },
    ]);
  });

  it.each([
    ["not an array", "load-balancer"],
    ["too long a list", Array.from({ length: 13 }, () => "service")],
    ["a non-string entry", ["service", 3]],
    ["an over-long entry", ["x".repeat(41)]],
  ])("drops %s rather than rejecting the whole queue", (_label, kinds) => {
    expect(parsePendingChanges([{ request: "a", instruction: "b", kinds }])).toEqual([{ request: "a", instruction: "b" }]);
  });

  it("still rejects a queue whose request or instruction is malformed", () => {
    expect(parsePendingChanges([{ request: "a", kinds: ["service"] }])).toBeNull();
  });
});
