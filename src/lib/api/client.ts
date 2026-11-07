/**
 * Planly Learning Service API Client & Event Streamer
 * Sprint: B09
 * Authority: planly_architecture.md sections 1, 4, 8
 */

import {
  LearningApiClient,
  type RunEvent,
  type RunStatusResponse,
  type RunEventsResponse,
  type ClassroomRecord,
  type SessionRecord,
  type ArtifactRecord,
  type MessageRecord,
  type LessonTurnInput,
  type LessonTurnResponse,
  type ContextPacket,
  type TeachingDecision,
  type ExecutionStatus,
  type TestResult,
  type ExecutionRecord,
  type ExecutionRequestInput,
  type ExecutionResponse,
} from "@contracts/learning-client";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createDevToken } from "@/lib/api/learning-client";

// Re-export wire contracts for UI consumption
export type {
  RunEvent,
  RunStatusResponse,
  RunEventsResponse,
  ClassroomRecord,
  SessionRecord,
  ArtifactRecord,
  MessageRecord,
  LessonTurnInput,
  LessonTurnResponse,
  ContextPacket,
  TeachingDecision,
  ExecutionStatus,
  TestResult,
  ExecutionRecord,
  ExecutionRequestInput,
  ExecutionResponse,
};

let _singletonClient: LearningApiClient | null = null;

/**
 * Returns a configured LearningApiClient instance.
 * Defaults to environment variable or local FastAPI endpoint (port 8000).
 */
export function getLearningClient(baseUrl?: string, tokenGetter?: () => Promise<string | null> | string | null): LearningApiClient {
  if (baseUrl || tokenGetter) {
    return new LearningApiClient(
      baseUrl || process.env.NEXT_PUBLIC_LEARNING_API_URL || "http://localhost:8000",
      tokenGetter || (() => null)
    );
  }

  if (!_singletonClient) {
    const url =
      process.env.NEXT_PUBLIC_LEARNING_API_URL ||
      process.env.LEARNING_SERVICE_URL ||
      "http://localhost:8000";
    _singletonClient = new LearningApiClient(url, () => {
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("planly_auth_token");
        if (stored) return stored;
        const configured = Boolean(
          process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
          !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.includes("placeholder") &&
          !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.startsWith("dummy")
        );
        if (configured) {
          return createSupabaseBrowserClient().auth.getSession().then(({ data }) =>
            data.session?.access_token ?? null
          );
        }
        return createDevToken();
      }
      return null;
    });
  }
  return _singletonClient;
}

export interface StreamOptions {
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  onThinking?: (payload: Record<string, unknown>) => void;
  onChunk?: (delta: string) => void;
  onDecision?: (decision: Record<string, unknown>) => void;
  onError?: (err: Error) => void;
}

/**
 * Streams events for a durable run starting from afterSeq.
 * Supports resume on reload, reconnecting without event duplication (B09-AC1).
 */
export async function streamRunEvents(
  client: LearningApiClient,
  runId: string,
  afterSeq: number = 0,
  options: StreamOptions = {}
): Promise<{ latestSeq: number; isComplete: boolean; status: RunStatusResponse }> {
  const {
    pollIntervalMs = 250,
    maxPollAttempts = 120,
    signal,
    onEvent,
    onThinking,
    onChunk,
    onDecision,
    onError,
  } = options;

  let currentSeq = afterSeq;
  let attempts = 0;
  const seenSeqs = new Set<number>();

  while (attempts < maxPollAttempts) {
    if (signal?.aborted) {
      throw new Error("Stream aborted by client");
    }

    try {
      const response: RunEventsResponse = await client.getRunEvents(runId, currentSeq);

      for (const ev of response.events) {
        if (!seenSeqs.has(ev.seq)) {
          seenSeqs.add(ev.seq);
          currentSeq = Math.max(currentSeq, ev.seq);

          if (onEvent) onEvent(ev);

          if (ev.event_type === "thinking" && onThinking) {
            onThinking(ev.payload);
          } else if (ev.event_type === "chunk" && onChunk) {
            const delta = typeof ev.payload?.delta === "string" ? ev.payload.delta : "";
            if (delta) onChunk(delta);
          } else if (ev.event_type === "decision" && onDecision) {
            onDecision(ev.payload);
          }
        }
      }

      if (response.is_complete) {
        const finalStatus = await client.getRunStatus(runId);
        return {
          latestSeq: currentSeq,
          isComplete: true,
          status: finalStatus,
        };
      }
    } catch (err: unknown) {
      if (onError && err instanceof Error) {
        onError(err);
      }
    }

    attempts++;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const finalStatus = await client.getRunStatus(runId);
  return {
    latestSeq: currentSeq,
    isComplete: finalStatus.state === "completed",
    status: finalStatus,
  };
}
