import { NextResponse } from "next/server";
import { chatWithProject } from "@archsim/engine/server";
import type { SystemModel } from "@archsim/engine";

/**
 * Server-only, same reason as api/infer/route.ts. Backs the sidebar chat
 * box for an EXISTING project — never resets or replaces it, only ever
 * answers a question or applies a change the AI itself decided the
 * message calls for (see chatWithProject.ts).
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const { model, message, history } =
    (body as { model?: unknown; message?: unknown; history?: unknown }) ?? {};
  if (!model || typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json(
      { error: "Expected { model: SystemModel, message: string }." },
      { status: 400 },
    );
  }

  // Structurally compatible with Anthropic.MessageParam[] (plain string
  // content) without needing the SDK type here — the store is the one
  // place that builds this from `chatMessages`, already bounded to a
  // short window (see store.ts's own comment).
  const chatHistory = Array.isArray(history)
    ? (history as { role: "user" | "assistant"; content: string }[])
    : [];

  try {
    const result = await chatWithProject(model as SystemModel, message, chatHistory);
    return NextResponse.json({
      isQuestion: result.isQuestion,
      reply: result.reply,
      model: result.model,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Chat failed.";
    return NextResponse.json({ error: errorMessage }, { status: 502 });
  }
}
