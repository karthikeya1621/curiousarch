/**
 * Regression test for a live bug: the tool schema fromProse sent to the API
 * used zod-to-json-schema's "openApi3" target, which emits OpenAPI-style
 * boolean exclusiveMinimum/Maximum (from Zod's .positive()/.negative()).
 * That isn't valid JSON Schema draft 2020-12, and the API rejected every
 * call with a 400 before generation ever started — caught only once a live
 * key had credit. This validates the actual tool input schema against the
 * 2020-12 meta-schema offline, so a future schema change that reintroduces
 * an incompatible keyword fails a test instead of a live call.
 */

import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { buildToolInputSchema } from "../src/inference/fromProse.js";
import { buildCoverageToolInputSchema } from "../src/inference/coverage.js";
import { buildExtendedToolInputSchema, ProposeResponseSchema, ReviseResponseSchema } from "../src/inference/extendedComponents.js";

describe("tool input schema", () => {
  it("validates as JSON Schema draft 2020-12", () => {
    const schema = buildToolInputSchema();
    const ajv = new Ajv2020({ strict: false });
    expect(() => ajv.compile(schema)).not.toThrow();
  });

  it("uses numeric exclusiveMinimum, not OpenAPI's boolean form", () => {
    const schema = JSON.stringify(buildToolInputSchema());
    // The OpenAPI 3.0 style is `"exclusiveMinimum": true` alongside a
    // separate "minimum" — draft 2020-12 wants the bound directly on
    // exclusiveMinimum as a number, e.g. `"exclusiveMinimum": 0`.
    expect(schema).not.toMatch(/"exclusiveMinimum":true/);
    expect(schema).not.toMatch(/"exclusiveMaximum":true/);
  });

  it("does not carry a stale draft-07 $schema pointer", () => {
    const schema = buildToolInputSchema();
    expect(schema.$schema).toBeUndefined();
  });

  it("every $ref points at a top-level definitions entry, never a nested path within one", () => {
    // Two distinct live 400s, both from the same root cause (a Zod object
    // reused across multiple fields, without an explicit `definitions`
    // entry for it):
    //   1. "References must be defined under '$defs' or 'definitions', not
    //      'properties'" — $ref pointed at a field's own in-document path
    //      (e.g. #/properties/components/.../id).
    //   2. "Reference to non-existent definition:
    //      #/definitions/BooleanTrait/properties/provenance" — $ref pointed
    //      *into* a definitions entry's nested property (ProvenanceSchema,
    //      reused inside every trait schema) instead of a sibling top-level
    //      entry, because only BooleanTraitSchema had been hoisted, not
    //      ProvenanceSchema too. A regex that only checked the ref *starts
    //      with* "#/definitions/" would pass this broken case — it does
    //      start with that — so this asserts the ref is *exactly*
    //      "#/definitions/<name>" with no further path segments.
    const schema = buildToolInputSchema();
    const refs = [...JSON.stringify(schema).matchAll(/"\$ref":"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref).toMatch(/^#\/(definitions|\$defs)\/[^/]+$/);
    }
  });

  it("carries no numeric bound keywords anywhere in the tree", () => {
    // Strict mode (constrained decoding) rejects exclusiveMinimum outright
    // ("property 'exclusiveMinimum' is not supported") — discovered live.
    // minimum/maximum/exclusiveMaximum are stripped alongside it since they
    // were never confirmed safe either; the real bound is enforced by
    // SystemModelSchema.safeParse() after generation, not by this schema.
    const schema = JSON.stringify(buildToolInputSchema());
    for (const keyword of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"]) {
      expect(schema).not.toContain(`"${keyword}"`);
    }
  });

  it("never sets an array minItems above 1", () => {
    // Discovered live, the hard way: a real 400 — "For 'array' type,
    // 'minItems' values other than 0 or 1 are not supported" — when
    // components.min(2) was tried directly on SystemModelSchema (the same
    // declaration feeds this schema, so the constraint leaked straight into
    // the live request). The real "at least 2 components" rule now lives in
    // SystemModelSchema's superRefine instead (see schema.test.ts), which
    // isn't representable in JSON Schema and so never reaches this tree.
    const schema = JSON.stringify(buildToolInputSchema());
    const values = [...schema.matchAll(/"minItems":(\d+)/g)].map((m) => Number(m[1]));
    for (const v of values) {
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("the revise step's tool input schema (keep / remove / components / edges)", () => {
  const schema = buildExtendedToolInputSchema(ReviseResponseSchema);

  it("validates as JSON Schema draft 2020-12", () => {
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow();
  });

  it("requires all four fields, forbids extras, and types keep/remove as string arrays", () => {
    const s = schema as { required?: string[]; additionalProperties?: boolean; properties: Record<string, { type?: string; items?: { type?: string } }> };
    expect([...(s.required ?? [])].sort()).toEqual(["components", "edges", "keep", "remove"]);
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.keep).toMatchObject({ type: "array", items: { type: "string" } });
    expect(s.properties.remove).toMatchObject({ type: "array", items: { type: "string" } });
  });

  it("every $ref points at a top-level definitions entry", () => {
    const refs = JSON.stringify(schema).match(/"\$ref":"[^"]+"/g) ?? [];
    for (const ref of refs) expect(ref).toMatch(/"\$ref":"#\/definitions\/[A-Za-z0-9_]+"/);
  });
});

describe("the propose step's tool input schema (considered / components / edges)", () => {
  const schema = buildExtendedToolInputSchema(ProposeResponseSchema);

  it("validates as JSON Schema draft 2020-12, requires all three fields and forbids extras", () => {
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow();
    const s = schema as { required?: string[]; additionalProperties?: boolean };
    expect([...(s.required ?? [])].sort()).toEqual(["components", "considered", "edges"]);
    expect(s.additionalProperties).toBe(false);
  });

  it("every $ref points at a top-level definitions entry", () => {
    const refs = JSON.stringify(schema).match(/"\$ref":"[^"]+"/g) ?? [];
    for (const ref of refs) expect(ref).toMatch(/"\$ref":"#\/definitions\/[A-Za-z0-9_]+"/);
  });
});

describe("the coverage check's tool input schema", () => {
  const schema = buildCoverageToolInputSchema();
  it("validates as JSON Schema draft 2020-12 and forbids extra properties", () => {
    expect(() => new Ajv2020({ strict: false }).compile(schema)).not.toThrow();
    expect((schema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
  });
});
