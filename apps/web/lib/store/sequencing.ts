/**
 * Sequencing for async work that writes back into the store after an
 * `await` (findings, chat, opening a project). Without these, a slow
 * response lands in whatever project happens to be open by then — e.g. a
 * chat change requested in project A getting applied to (and autosaved
 * into) project B after the user switched.
 *
 * - `epoch` bumps whenever the open project/build is replaced; anything
 *   started under an older epoch is dropped on arrival.
 * - `findings` bumps per `refreshFindings` call; within one epoch only the
 *   most recent call may update `findings`, so an older response (e.g. an
 *   older Re-simulate's result arriving after a newer one's) can't
 *   overwrite newer state.
 * - `open` bumps per project open, so of two rapid clicks the LAST one wins
 *   rather than whichever network response happens to land last.
 *
 * One shared mutable object, deliberately NOT store state: nothing renders
 * from these, and an update must be visible synchronously to every slice
 * (a `set()` would batch). Module-level, so it also spans the lifetime of
 * the page rather than any one project.
 */
export const sequence = { epoch: 0, findings: 0, open: 0 };
