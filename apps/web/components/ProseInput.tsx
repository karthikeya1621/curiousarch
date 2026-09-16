"use client";

import { useState } from "react";
import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";
import { Card } from "./Card";
import { SparklesIcon } from "./icons";

export function ProseInput() {
  const setModel = useAppStore((s) => s.setModel);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!description.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Inference failed.");
      setModel(body.model as SystemModel);
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
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"
      >
        <SparklesIcon className="h-4 w-4 text-slate-400" />
        Describe your own system
      </label>
      <p className="mt-1 text-xs text-slate-500">
        Prose in, a model out — components, edges, and workload, each
        parameter tagged with its provenance so you know what to correct.
      </p>
      <textarea
        id="prose-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="e.g. A checkout API backed by a Postgres database with a connection pool of 20 and a 25ms average query time..."
        className="mt-3 w-full flex-1 min-h-40 resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={loading || !description.trim()}
          className="w-full rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white transition-colors enabled:hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading ? "Inferring…" : "Build model"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </Card>
  );
}
