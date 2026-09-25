/**
 * How the tier ladders (users 100 / 10K / 1M / 100M, requests 1K / 100K / 10M /
 * 1B) map to how many instances things need. It is GUIDANCE for the AI's own
 * judgement, deliberately not a threshold in code: the product decision is that
 * instance counts are set by the AI from the tier group, per component, so a
 * batch job can stay single at a scale where the request path cannot.
 * Shared by the base rework prompt and the extended-components revise prompt so
 * the two never disagree about what a tier means.
 */
export const TIER_GROUP_GUIDE = `Tier groups, as guidance for your own judgement (not a formula):
- Lowest tier (100 users / 1,000 requests): a launch. One instance of a service and a single database are normal - leave them as they are.
- Second tier (10,000 users / 100,000 requests): real users and real traffic. A service on the request path whose failure would be an outage is normally worth running as more than one instance; a database gets replicas only if it holds state the system cannot lose.
- Third tier (1,000,000 users / 10,000,000 requests): large. Services on the request path run multiple instances, a load balancer runs multiple, and a database that many services read from normally has replicas.
- Highest tier (100,000,000 users / 1,000,000,000 requests): massive. Everything on the request path runs multiple instances and databases have replicas.
When both users and requests are in use, judge by the higher group. Judge each component by its own role: a scheduled job or a rarely used back-office service can stay single at any tier.`;
