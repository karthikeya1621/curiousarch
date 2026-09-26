# Cost and usage

> Part of the project context; the index is [`CONTEXT.md`](../../CONTEXT.md). What the usage dashboard showed about where money goes, and the levers chosen because of it. Read before changing prompts for cost or output length.

Each section below is one decision: the heading is the decision, the text is the reason and the evidence. A decision marked ~~struck through~~ or "superseded" is kept on purpose, so the reasoning is not lost.

## Cost work is driven by the usage dashboard's numbers, not guesses

With ~$0.81 of real usage logged: 54% of all spend was Re-simulate, and 48% of THAT was failed attempts (every retry was in Re-simulate; builds, findings and chat never retried). After the base-view / extended-edges fixes the first live Re-simulate needed zero retries — one sample, worth re-checking. A clean Re-simulate's floor is output tokens (~60% of its cost: the rework re-writes the whole model, mostly per-trait rationale prose), so the rework/build/extended prompts now ask for one short rationale of roughly 8 to 15 words — kept above the validator's 10-character minimum so brevity can't itself cause a retry; measure the effect in the dashboard's "Avg out tok" per step. Prompt caching is not a lever here (Re-simulates are further apart than the 5-minute cache, so it costs ~0.2 cents/call in write premium for almost no reads). The dashboard now shows the retry bill directly: a "Wasted on failed attempts" KPI, a per-day chart with the wasted share inside each bar, and a Wasted column per step (needs `db/ai-usage.sql` re-run; the page degrades to "—" until then).
