/**
 * How the tier ladders (users 100 / 10K / 1M / 100M, requests 1K / 100K / 10M /
 * 1B) map to how many instances things need. It is GUIDANCE for the AI's own
 * judgement, deliberately not a threshold in code: the product decision is that
 * instance counts (and the baseline protections) are set by the AI from the tier group, per component, so a
 * batch job can stay single at a scale where the request path cannot.
 * Shared by the base rework prompt and the extended-components revise prompt so
 * the two never disagree about what a tier means.
 */
export const TIER_GROUP_GUIDE = `Tier groups, as guidance for your own judgement (not a formula):
- Lowest tier (100 users / 1,000 requests): a launch. One instance of a service and a single database are normal - leave them as they are.
- Second tier (10,000 users / 100,000 requests): real users and real traffic. A service on the request path whose failure would be an outage is normally worth running as more than one instance; a database gets replicas only if it holds state the system cannot lose.
- Third tier (1,000,000 users / 10,000,000 requests): large. Services on the request path run multiple instances, a load balancer runs multiple, and a database that many services read from normally has replicas.
- Highest tier (100,000,000 users / 1,000,000,000 requests): massive. Everything on the request path runs multiple instances and databases have replicas.
When both users and requests are in use, judge by the higher group. Judge each component by its own role: a scheduled job or a rarely used back-office service can stay single at any tier.

Protections follow the tier too, but only the BASELINE a team at that scale would not launch without. Everything else is what the separate review reports at every tier, so it stays off unless the description or a request says otherwise:
- Lowest and second tier: no protections, unless the description states one.
- Third tier and above: the baseline is rate limiting on a public gateway, health checks on a load balancer, and a timeout on a call to an external provider. Circuit breakers, stampede protection, dead-letter queues, fallbacks, versioning, locking and origin shields are NOT baseline - leave them as they are.
Apply this to a component you ADD and to existing ones alike, in both directions: raising the scale may switch a baseline protection on, and lowering it returns one you set yourself (provenance "inferred") to off. A protection the description states, or a request asked for, stays whatever the scale.`;
