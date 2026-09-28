"use client";

import { useState } from "react";
import type { SystemModel } from "@archsim/engine";
import { useAppStore, usageProjectId } from "../lib/store";
import { newActionId, reportOutcome } from "../lib/usageClient";
import { isTrialLimit, notifyTrialLimit } from "../lib/trialClient";
import { MAX_DESCRIPTION_LENGTH } from "../lib/limits";
import { Card } from "./Card";
import { SparklesIcon } from "./icons";

export function ProseInput() {
  const setModel = useAppStore((s) => s.setModel);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remaining = MAX_DESCRIPTION_LENGTH - description.length;

  async function submit() {
    if (!description.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      // One id for the whole build — this call, and the findings refresh
      // `setModel` starts — so its cost and the version it produces join up.
      const actionId = newActionId();
      const res = await fetch("/api/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description, actionId, projectId: usageProjectId() }),
      });
      const body = await res.json();
      if (!res.ok) {
        // The banner at the top already says the trial is used up - no second message here.
        if (isTrialLimit(body)) return notifyTrialLimit(body);
        if (body.code === "unsafe-result") reportOutcome(actionId, "withheld"); // paid for, but the engine refused to return it
        throw new Error(body.error ?? "Inference failed.");
      }
      setModel(body.model as SystemModel, actionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inference failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card padding="sm" className="flex h-full flex-col">
      <label
        htmlFor="prose-description"
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-900 dark:text-slate-100"
      >
        <SparklesIcon className="h-4 w-4 text-slate-400" />
        Describe the system you want to build
      </label>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Plain English in, an architecture out. Mention a user count or a
        request rate and that becomes a parameter you can raise later —
        starting low either way, so you can see what breaks as you grow it.
      </p>
      <textarea
        id="prose-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={MAX_DESCRIPTION_LENGTH}
        placeholder="e.g. A movie booking system for 1M users..."
        className="mt-3 w-full flex-1 min-h-40 resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:bg-slate-800"
      />
      <p className={"mt-1 text-right text-[11px] " + (remaining < 100 ? "text-amber-600 dark:text-amber-400" : "text-slate-400")}>
        {description.length} / {MAX_DESCRIPTION_LENGTH}
      </p>
      <div className="mt-1 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={loading || !description.trim()}
          className="w-full rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition-colors enabled:hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-slate-100 dark:text-slate-900 dark:enabled:hover:bg-slate-300 dark:disabled:bg-slate-600"
        >
          {loading ? "Inferring…" : "Build model"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </Card>
  );
}
