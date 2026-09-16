/**
 * Queueing primitives.
 *
 * This file is the one place where being subtly wrong destroys the product, so
 * every function states its model and its assumptions. All rates are per second
 * and all times are seconds. Callers convert at the boundary.
 *
 * Standing assumptions (documented because users will ask):
 *   - Poisson arrivals, exponential service times (M/M/c).
 *   - Infinite queue capacity unless a component models its own bound.
 *   - No priority, no batching, no coordinated omission.
 * Real systems violate all of these. The numbers are directional, and the UI
 * must say so.
 */

export interface QueueMetrics {
  /** Offered load in erlangs: lambda / mu. */
  offeredLoad: number;
  /** Server utilization: a / c. >= 1 means unbounded growth. */
  utilization: number;
  /** Mean time waiting for a server, excluding service. */
  meanWaitSeconds: number;
  /** Mean total time in system: wait + service. */
  meanResponseSeconds: number;
  /** Mean number in system (Little's Law: L = lambda * W). */
  meanInSystem: number;
  stable: boolean;
}

/**
 * Erlang B, computed with the standard numerically stable recursion rather than
 * the factorial form, which overflows past c ~ 170.
 *
 *   B(0, a) = 1
 *   B(k, a) = a*B(k-1,a) / (k + a*B(k-1,a))
 */
export function erlangB(servers: number, offeredLoad: number): number {
  if (servers < 0) throw new Error("servers must be >= 0");
  let b = 1;
  for (let k = 1; k <= servers; k++) {
    b = (offeredLoad * b) / (k + offeredLoad * b);
  }
  return b;
}

/**
 * Erlang C — probability an arriving request has to wait at all.
 * Derived from Erlang B to stay numerically stable:
 *   C = B / (1 - rho*(1 - B)),  rho = a/c
 */
export function erlangC(servers: number, offeredLoad: number): number {
  const rho = offeredLoad / servers;
  if (rho >= 1) return 1;
  const b = erlangB(servers, offeredLoad);
  return b / (1 - rho * (1 - b));
}

/**
 * M/M/c metrics. `servers` = 1 collapses to the exact M/M/1 results.
 */
export function mmc(
  arrivalRate: number,
  serviceRate: number,
  servers: number,
): QueueMetrics {
  if (serviceRate <= 0) throw new Error("serviceRate must be > 0");
  if (servers < 1) throw new Error("servers must be >= 1");

  const offeredLoad = arrivalRate / serviceRate;
  const utilization = offeredLoad / servers;
  const serviceTime = 1 / serviceRate;

  // Unstable: the queue grows without bound, so mean wait is undefined.
  // We return Infinity rather than a large finite number so callers cannot
  // accidentally render a plausible-looking latency for a broken system.
  if (utilization >= 1) {
    return {
      offeredLoad,
      utilization,
      meanWaitSeconds: Infinity,
      meanResponseSeconds: Infinity,
      meanInSystem: Infinity,
      stable: false,
    };
  }

  const c = erlangC(servers, offeredLoad);
  const meanWaitSeconds = c / (servers * serviceRate - arrivalRate);
  const meanResponseSeconds = meanWaitSeconds + serviceTime;

  return {
    offeredLoad,
    utilization,
    meanWaitSeconds,
    meanResponseSeconds,
    // Little's Law.
    meanInSystem: arrivalRate * meanResponseSeconds,
    stable: true,
  };
}

/**
 * Response-time quantile.
 *
 * For c = 1 this is exact: sojourn time in M/M/1 is exponential with rate
 * (mu - lambda), so the p-quantile is -ln(1-p)/(mu - lambda).
 *
 * For c > 1 only the *waiting* time has the clean form
 * P(Wq > t) = C * exp(-(c*mu - lambda) * t). We take that quantile and add the
 * mean service time. That understates the true tail slightly because it ignores
 * service-time variance above the mean. It is documented rather than hidden;
 * if calibration against real load tests shows this matters, replace it with a
 * proper convolution instead of tuning a fudge factor.
 */
export function responseQuantile(
  arrivalRate: number,
  serviceRate: number,
  servers: number,
  p: number,
): number {
  if (p <= 0 || p >= 1) throw new Error("p must be in (0,1)");
  const offeredLoad = arrivalRate / serviceRate;
  const utilization = offeredLoad / servers;
  if (utilization >= 1) return Infinity;

  const serviceTime = 1 / serviceRate;

  if (servers === 1) {
    return -Math.log(1 - p) / (serviceRate - arrivalRate);
  }

  const c = erlangC(servers, offeredLoad);
  const decay = servers * serviceRate - arrivalRate;
  const tail = 1 - p;
  // If the chance of waiting at all is below the tail mass we're asking about,
  // the quantile of waiting time is zero — the request is served immediately.
  const waitQuantile = c > tail ? Math.log(c / tail) / decay : 0;
  return waitQuantile + serviceTime;
}

/**
 * Tail amplification from parallel fan-out (Dean & Barroso, "The Tail at
 * Scale"). If a request must collect n independent responses, the slowest one
 * governs. For n calls each with per-call tail probability q, the chance the
 * overall request exceeds that latency is 1 - (1-q)^n.
 *
 * Returns the effective percentile a single downstream call must meet for the
 * fanned-out request to hit `targetP`.
 */
export function fanoutEffectiveQuantile(
  targetP: number,
  fanout: number,
): number {
  if (fanout <= 1) return targetP;
  return Math.pow(targetP, 1 / fanout);
}

/** Little's Law, exposed directly because the UI shows the derivation. */
export function littlesLaw(arrivalRate: number, responseSeconds: number) {
  return arrivalRate * responseSeconds;
}
