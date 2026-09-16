/**
 * Math tests. Every expected value here is derived on paper from a textbook
 * formula, not captured from a previous run. A snapshot test would happily
 * lock in a wrong model.
 */

import { describe, expect, it } from "vitest";
import {
  erlangB,
  erlangC,
  fanoutEffectiveQuantile,
  littlesLaw,
  mmc,
  responseQuantile,
} from "../src/queueing.js";

describe("M/M/1", () => {
  // lambda=80, mu=100 => rho=0.8, W = 1/(mu-lambda) = 50ms, L = lambda*W = 4
  it("matches the closed form", () => {
    const m = mmc(80, 100, 1);
    expect(m.utilization).toBeCloseTo(0.8, 10);
    expect(m.meanResponseSeconds).toBeCloseTo(0.05, 10);
    expect(m.meanWaitSeconds).toBeCloseTo(0.04, 10);
    expect(m.meanInSystem).toBeCloseTo(4, 10);
    expect(m.stable).toBe(true);
  });

  // Sojourn time is exponential with rate (mu - lambda) = 20.
  // p99 = -ln(0.01)/20 = 0.2303s
  it("has an exact exponential tail", () => {
    expect(responseQuantile(80, 100, 1, 0.99)).toBeCloseTo(
      Math.log(100) / 20,
      10,
    );
  });

  it("reports Infinity rather than a plausible number when unstable", () => {
    const m = mmc(100, 100, 1);
    expect(m.stable).toBe(false);
    expect(m.meanResponseSeconds).toBe(Infinity);
    expect(responseQuantile(120, 100, 1, 0.99)).toBe(Infinity);
  });
});

describe("Erlang formulas", () => {
  // B(1,a) = a/(1+a). For a=1: 0.5
  it("computes Erlang B by recursion", () => {
    expect(erlangB(1, 1)).toBeCloseTo(0.5, 10);
    // B(2,1) = a*B1/(2 + a*B1) = 0.5/2.5 = 0.2
    expect(erlangB(2, 1)).toBeCloseTo(0.2, 10);
  });

  it("stays finite well past the factorial overflow point", () => {
    // c=500 would overflow a naive a^c/c! implementation.
    const b = erlangB(500, 400);
    expect(Number.isFinite(b)).toBe(true);
    expect(b).toBeGreaterThan(0);
  });

  it("collapses to rho for a single server", () => {
    // For c=1, Erlang C equals the utilization.
    expect(erlangC(1, 0.7)).toBeCloseTo(0.7, 10);
  });

  it("returns certainty of waiting at saturation", () => {
    expect(erlangC(4, 4)).toBe(1);
    expect(erlangC(4, 9)).toBe(1);
  });
});

describe("M/M/c", () => {
  // c=2, mu=1, lambda=1 => a=1, rho=0.5.
  // B(2,1)=0.2 => C = 0.2/(1 - 0.5*0.8) = 0.2/0.6 = 1/3
  // Wq = C/(c*mu - lambda) = (1/3)/1 = 0.3333, W = Wq + 1 = 1.3333
  it("matches the hand-computed Erlang C result", () => {
    const m = mmc(1, 1, 2);
    expect(m.meanWaitSeconds).toBeCloseTo(1 / 3, 10);
    expect(m.meanResponseSeconds).toBeCloseTo(4 / 3, 10);
    expect(m.meanInSystem).toBeCloseTo(4 / 3, 10);
  });

  it("beats c single queues at the same total capacity", () => {
    // Pooling wins: one queue of 4 servers outperforms 4 separate M/M/1s.
    const pooled = mmc(3.6, 1, 4);
    const split = mmc(0.9, 1, 1);
    expect(pooled.meanResponseSeconds).toBeLessThan(split.meanResponseSeconds);
  });

  it("reports no queueing delay when waiting is rarer than the tail mass", () => {
    // Lightly loaded: P(wait) < 0.01, so the p99 is pure service time.
    const q = responseQuantile(0.1, 1, 10, 0.99);
    expect(q).toBeCloseTo(1, 10);
  });
});

describe("Little's Law", () => {
  it("is consistent with the M/M/c result", () => {
    const m = mmc(240, 100, 4);
    expect(littlesLaw(240, m.meanResponseSeconds)).toBeCloseTo(
      m.meanInSystem,
      10,
    );
  });
});

describe("fan-out tail amplification", () => {
  // Dean & Barroso: 100 parallel calls at p99 each => ~63% of requests slow.
  it("reproduces the tail-at-scale result", () => {
    const survival = Math.pow(0.99, 100);
    expect(1 - survival).toBeCloseTo(0.634, 2);
  });

  it("tightens the per-call target as fan-out grows", () => {
    const single = fanoutEffectiveQuantile(0.99, 1);
    const many = fanoutEffectiveQuantile(0.99, 100);
    expect(single).toBe(0.99);
    // 0.99^(1/100) = 0.99989950..., i.e. each call must hit ~p99.99.
    expect(many).toBeCloseTo(0.9998995, 7);
  });
});
