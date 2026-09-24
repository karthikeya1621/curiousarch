import { NextResponse } from "next/server";
import { chatWithProject } from "@archsim/engine/server";
import type { PendingFixInput } from "@archsim/engine/server";
import type { AiFinding, SystemModel } from "@archsim/engine";
import { MAX_CHAT_MESSAGE_LENGTH, isValidModelShape, parsePendingChanges } from "../../../lib/limits";
import { readJsonBody, upstreamError } from "../../../lib/apiRoute";
import { startUsage } from "../../../lib/usage/server";
import { describeModel } from "../../../lib/usage/context";

/**
 * Server-only, same reason as api/infer/route.ts. Backs the sidebar chat
 * box for an EXISTING project — never resets or replaces it, and never
 * edits it: it answers a question, or turns a change request into an
 * `instruction` the client queues for the next Re-simulate (see
 * chatWithProject.ts).
 */
export async function POST(request: Request) {
  const parsed = await readJsonBody(request);
  if ("error" in parsed) return parsed.error;
  const body = parsed.body;

  const { model, message, history, findings, pendingFixes, pendingChanges } =
    (body as {
      model?: unknown;
      message?: unknown;
      history?: unknown;
      findings?: unknown;
      pendingFixes?: unknown;
      pendingChanges?: unknown;
    }) ?? {};
  if (
    !model ||
    !isValidModelShape(model) ||
    typeof message !== "string" ||
    message.trim().length === 0 ||
    message.length > MAX_CHAT_MESSAGE_LENGTH
  ) {
    return NextResponse.json(
      {
        error: `Expected { model: SystemModel, message: string } — message must be non-empty and at most ${MAX_CHAT_MESSAGE_LENGTH} characters, and model must be a valid, reasonably-sized SystemModel.`,
      },
      { status: 400 },
    );
  }

  const queuedChanges = parsePendingChanges(pendingChanges);
  if (queuedChanges === null) {
    return NextResponse.json({ error: "pendingChanges must be a short list of { request, instruction } strings." }, { status: 400 });
  }

  // Structurally compatible with Anthropic.MessageParam[] (plain string
  // content) without needing the SDK type here — the store is the one
  // place that builds this from `chatMessages`, already bounded to a
  // short window (see `CHAT_HISTORY_WINDOW` in lib/store/slices/chatSlice.ts).
  const chatHistory = Array.isArray(history)
    ? (history as { role: "user" | "assistant"; content: string }[])
    : [];
  // What the dashboard is currently showing — see chatWithProject.ts's own
  // comment on why this matters (chat used to re-derive answers from the
  // raw model alone, with zero visibility into a queued-but-unapplied fix).
  const currentFindings = Array.isArray(findings) ? (findings as AiFinding[]) : [];
  const currentPendingFixes = Array.isArray(pendingFixes) ? (pendingFixes as PendingFixInput[]) : [];

  try {
    const usage = await startUsage(body, {
      action: "chat",
      context: {
        ...describeModel(model as SystemModel),
        messageChars: message.length,
        historyTurns: chatHistory.length,
        findings: currentFindings.length,
        pendingFixes: currentPendingFixes.length,
        pendingChanges: queuedChanges.length,
      },
    });
    const result = await chatWithProject(
      model as SystemModel,
      message,
      chatHistory,
      currentFindings,
      currentPendingFixes,
      queuedChanges,
      usage,
    );
    return NextResponse.json({
      isQuestion: result.isQuestion,
      reply: result.reply,
      instruction: result.instruction,
    });
  } catch (err) {
    return upstreamError(err, "Chat failed.");
  }
}
