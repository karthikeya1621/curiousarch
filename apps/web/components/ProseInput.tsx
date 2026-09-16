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
    <Card padding="sm">
      <label
        htmlFor="prose-description"
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"
      >
        <SparklesIcon className="h-4 w-4 text-slate-400" />
        Describe your own system
      </label>
      <textarea
        id="prose-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        placeholder="e.g. A checkout API backed by a Postgres database with a connection pool of 20 and a 25ms average query time..."
        className="mt-2.5 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none"
      />
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={loading || !description.trim()}
          className="rounded-lg bg-slate-900 px-3.5 py-1.5 text-sm font-medium text-white transition-colors enabled:hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading ? "Inferring…" : "Build model"}
        </button>
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    </Card>
  );
}
