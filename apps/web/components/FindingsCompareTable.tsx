import { Fragment } from "react";
import type { Finding } from "@archsim/engine";
import { CheckCircleIcon } from "./icons";

/**
 * Finding codes are SNAKE_CASE ("CONNECTION_POOL_EXHAUSTED") — a forced
 * break-anywhere wrap chops them mid-word ("SATURATE" / "D"). A `<wbr>`
 * after each underscore gives the browser a natural break point instead,
 * so a wrap (when the column is too narrow) lands between words.
 */
function BreakableCode({ code }: { code: string }) {
  const parts = code.split("_");
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && "_"}
          {i > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </>
  );
}

/**
 * A compact presence grid across 2-3 states (baseline / under a failure /
 * failure+fix), used instead of rendering full FindingsList evidence blocks
 * side by side. That approach collided badly at the sidebar's ~340px width
 * — three (or even two) columns of multi-line evidence text has nowhere to
 * wrap and the cards overlap. A code-presence table scans at a glance and
 * scales to any width; full evidence for the state that actually matters
 * (see each caller) is still shown underneath via FindingsList, so nothing
 * numeric is lost — it's just not tripled.
 *
 * `table-fixed` + an explicit `<colgroup>` is required here, not optional
 * polish: a plain auto-layout table sizes columns from their widest cell
 * content across every row, and a finding code like
 * "CONNECTION_POOL_EXHAUSTED" is far wider than the "Before"/"Failure"/
 * "+ Fix" header labels — without fixed layout the status columns get
 * squeezed to near zero and the header text overlaps.
 */
export function FindingsCompareTable({
  columns,
}: {
  columns: { label: string; findings: Finding[] }[];
}) {
  const codes = Array.from(
    new Set(columns.flatMap((c) => c.findings.map((f) => f.code))),
  );

  if (codes.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
        <CheckCircleIcon className="h-4 w-4" />
        No findings in any state.
      </p>
    );
  }

  const statusColWidth = `${58 / columns.length}%`;

  return (
    <table className="w-full table-fixed border-collapse text-xs">
      <colgroup>
        <col />
        {columns.map((c) => (
          <col key={c.label} style={{ width: statusColWidth }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th className="pb-1.5 text-left font-semibold text-slate-400" />
          {columns.map((c) => (
            <th
              key={c.label}
              className="pb-1.5 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400"
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {codes.map((code) => {
          const severity = columns
            .flatMap((c) => c.findings)
            .find((f) => f.code === code)?.severity;
          return (
            <tr key={code} className="border-t border-slate-100">
              <td className="py-1.5 pr-2 font-medium text-slate-700">
                <BreakableCode code={code} />
              </td>
              {columns.map((c) => {
                const present = c.findings.some((f) => f.code === code);
                return (
                  <td key={c.label} className="py-1.5 text-center">
                    <span
                      className={
                        "inline-block h-2 w-2 rounded-full " +
                        (present
                          ? severity === "critical"
                            ? "bg-rose-500"
                            : "bg-amber-500"
                          : "bg-slate-200")
                      }
                    />
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
