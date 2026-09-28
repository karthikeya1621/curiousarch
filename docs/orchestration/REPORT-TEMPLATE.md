# Findings report format

Specialists return their findings in this shape (the orchestrator merges them into one ledger).

## Per specialist (final message, no preamble)

A ranked list, most severe first, at most 20-25 items. Each item:

```
[SEVERITY] file:line - one-sentence statement of the defect
Scenario: the concrete input/state that triggers it and what goes wrong
Fix: the minimal change (exact class/attribute/line where possible)
Confidence: confirmed by reading code | plausible
```

Then two short lists: **Checked and sound** (areas reviewed with no problem) and **Not checked** (and why).

Severity: security/reliability use `critical | high | medium | low`; accessibility uses `blocker | major | minor`; performance uses `impact high | medium | low`; ops uses `blocker | high | medium | low`.

## Orchestrator ledger (in docs/orchestration/README.md "Runs", or a dated file)

| # | Source | Severity | Location | Finding | Verified by orchestrator | Decision | Status |
|---|---|---|---|---|---|---|---|
| 1 | security | high | app/api/x/route.ts:42 | ... | yes, read lines 30-60 | fix now | fixed in <commit> |

Decisions: `fix now` | `fix later` | `won't fix (reason)` | `false positive (why)`.

Closing block:

- Gate: typecheck / lint / tests (n) / build / browser check - each pass or fail
- Deferred (with reason and owner)
- Go / no-go for the stated launch context, and the one or two things that would change the answer
- Reliability score line if inference or the flow changed (rubric in the project memory)
