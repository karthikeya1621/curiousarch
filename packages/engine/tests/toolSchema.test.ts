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

  it("every $ref points into definitions, never at another path", () => {
    // Live 400: "References must be defined under '$defs' or 'definitions',
    // not 'properties'". zod-to-json-schema's $refStrategy "root" points a
    // $ref at the first occurrence's own path for any object it recognizes
    // as reused — Parameter deliberately (fixed via the explicit
    // `definitions` map), and, until fixed, also the shared id/label
    // instances from a spread base-fields object no one intended to reuse.
    const schema = buildToolInputSchema();
    const refs = [...JSON.stringify(schema).matchAll(/"\$ref":"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref).toMatch(/^#\/(definitions|\$defs)\//);
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
