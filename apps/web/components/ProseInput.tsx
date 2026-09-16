"use client";

import { useState } from "react";
import type { SystemModel } from "@archsim/engine";
import { useAppStore } from "../lib/store";

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
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <label htmlFor="prose-description" className="text-sm font-semibold">
        Describe your own system
      </label>
      <textarea
        id="prose-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        placeholder="e.g. A checkout API backed by a Postgres database with a connection pool of 20 and a 25ms average query time..."
        className="mt-2 w-full rounded border border-gray-300 p-2 text-sm"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={loading || !description.trim()}
          className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white enabled:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Inferring…" : "Build model"}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
