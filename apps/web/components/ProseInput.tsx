"use client";

import { useState } from "react";
import type { SystemModel } from "@archsim/engine";
import { useAppStore, usageProjectId } from "../lib/store";
import { sequence } from "../lib/store/sequencing";
import { newActionId, reportOutcome } from "../lib/usageClient";
import { isTrialLimit, notifyTrialLimit } from "../lib/trialClient";
import { MAX_DESCRIPTION_LENGTH } from "../lib/limits";
import { Card } from "./Card";
import { SparklesIcon } from "./icons";

const EXAMPLES = [
  {
    label: "Movie booking",
    text: "A movie booking system for 1M users: browse showtimes, pick seats, pay online and get an e-ticket by email.",
  },
  {
    label: "Real-time chat",
    text: "A real-time chat app with group channels, message history, online presence and push notifications for 100K users.",
  },
  {
    label: "Food delivery",
    text: "A food delivery app with restaurant menus, order placement, live courier tracking and online payment for 500K users.",
  },
  {
    label: "URL shortener",
    text: "A URL shortener that creates short links and redirects them fast, with click analytics, for 10M requests a day.",
  },
];

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
      // The session this build belongs to: opening a saved project while it runs starts a new epoch, and the
      // result must not land on top of that project (autosave would then overwrite it).
      const epoch = sequence.epoch;
      const res = await fetch("/api/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description, actionId, projectId: usageProjectId() }),
      });
      // A host error page (502/504) is HTML, not JSON: fall back to an empty body so the friendly message shows.
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The banner at the top already says the trial is used up - no second message here.
        if (isTrialLimit(body)) return notifyTrialLimit(body);
        if (body.code === "unsafe-result") reportOutcome(actionId, "withheld"); // paid for, but the engine refused to return it
        throw new Error(body.error ?? "Inference failed.");
      }
      if (epoch !== sequence.epoch) {
        reportOutcome(actionId, "project-switched"); // billed, but the project it was for is no longer open
        return;
      }
      setModel(body.model as SystemModel, actionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inference failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="flex h-full flex-col sm:p-6">
      <label
        htmlFor="prose-description"
        className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100"
      >
        <SparklesIcon className="h-5 w-5 text-amber-500" />
        Describe the system you want to build
      </label>
      <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
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
        className="mt-4 w-full flex-1 min-h-48 resize-none rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-base text-slate-900 sm:text-sm placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:bg-slate-800"
      />
      {/* A starting point, and a lesson in what a good description looks like. Fills the box; never submits. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500 dark:text-slate-400">Try:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => setDescription(ex.text)}
            disabled={loading}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-colors enabled:hover:border-slate-400 enabled:hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:enabled:hover:border-slate-500 dark:enabled:hover:bg-slate-700"
          >
            {ex.label}
          </button>
        ))}
      </div>
      <p className={"mt-2 text-right text-[11px] " + (remaining < 100 ? "text-amber-700 dark:text-amber-400" : "text-slate-500")}>
        {description.length} / {MAX_DESCRIPTION_LENGTH}
      </p>
      <div className="mt-1 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={loading || !description.trim()}
          className="w-full rounded-lg bg-slate-900 px-3.5 py-2.5 text-sm font-medium text-white transition-colors enabled:hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:bg-slate-100 dark:text-slate-900 dark:enabled:hover:bg-slate-300 dark:disabled:bg-slate-600"
        >
          {loading ? "Inferring…" : "Build model"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
    </Card>
  );
}
