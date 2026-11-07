"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getLearningClient,
  streamRunEvents,
  type ClassroomRecord,
  type SessionRecord,
  type ArtifactRecord,
  type MessageRecord,
  type ContextPacket,
  type ExecutionRecord,
  type ExecutionResponse,
} from "@/lib/api/client";

export interface ChatMessage {
  id: string;
  role: "learner" | "tutor" | "system";
  content: string;
  artifactRevision?: number;
  timestamp: string;
  isStreaming?: boolean;
}

export interface UseClassroomChatOptions {
  classroomId?: string;
  sessionId?: string;
  initialTrack?: string;
}

export function useClassroomChat({
  classroomId: propClassroomId,
  sessionId: propSessionId,
  initialTrack = "dsa",
}: UseClassroomChatOptions = {}) {
  const client = getLearningClient();

  const [classroom, setClassroom] = useState<ClassroomRecord | null>(null);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  // Code state: saved revision from backend vs local uncommitted draft
  const [savedCode, setSavedCode] = useState<string>("");
  const [draftCode, setDraftCode] = useState<string>("");
  const [savedRevision, setSavedRevision] = useState<number>(1);
  const isDraftModified = draftCode !== savedCode;

  // Message draft state
  const [messageDraft, setMessageDraft] = useState<string>("");

  // Loading & streaming state
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [latestExecution, setLatestExecution] = useState<ExecutionRecord | null>(null);
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [streamingText, setStreamingText] = useState<string>("");
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Save drafts locally in localStorage (B09 Requirement 2)
  useEffect(() => {
    if (!session?.id) return;
    try {
      const draftPayload = {
        draftCode,
        messageDraft,
        savedRevision,
      };
      localStorage.setItem(`planly_draft_${session.id}`, JSON.stringify(draftPayload));
    } catch {
      // LocalStorage quota or unavailable
    }
  }, [draftCode, messageDraft, savedRevision, session?.id]);

  // Load or initialize classroom & session
  const initializeClassroom = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let activeCls: ClassroomRecord | null = null;
      let activeSess: SessionRecord | null = null;

      // 1. Resolve classroom
      if (propClassroomId) {
        activeCls = await client.getClassroom(propClassroomId);
      } else {
        const classrooms = await client.listClassrooms();
        const found = classrooms.find((c: ClassroomRecord) => c.track === initialTrack);
        if (found) {
          activeCls = found;
        } else {
          // A classroom is durable owner state. Never manufacture an id in
          // the browser: create it through the authenticated API.
          activeCls = await client.createClassroom({
            track: initialTrack,
            title: `${initialTrack.toUpperCase()} Adaptive Classroom`,
          });
        }
      }
      setClassroom(activeCls);

      // 2. Resolve session
      if (propSessionId) {
        activeSess = await client.getSession(propSessionId);
      } else if (activeCls) {
        const sessions = await client.listSessions(activeCls.id);
        const active = sessions.find((s: SessionRecord) => s.status === "active");
        if (active) {
          activeSess = active;
        } else {
          activeSess = await client.createSession(activeCls.id, { stage: "foundation", mode: "learn" });
        }
      }
      setSession(activeSess);

      if (activeSess) {
        // 3. Load latest artifact
        const art = await client.getSessionArtifact(activeSess.id);
        const starterByTrack: Record<string, string> = {
          dsa: "# Write your solution here\ndef twoSum(nums, target):\n    pass\n",
          cs: "# Explain the process/thread memory model here\n# Address isolation, sharing, and synchronization.\n",
          ai_ml: "# Implement the assigned regression exercise here\nimport numpy as np\n",
        };
        const codeContent = art?.content || starterByTrack[activeCls?.track || initialTrack] || starterByTrack.dsa;
        // Artifact revision and session concurrency revision are distinct:
        // saving artifact rev N advances the session concurrency revision to
        // N+1. Keep the artifact badge on N and use the session value for
        // subsequent conditional writes/turn acceptance.
        const rev = art?.revision || 0;
        // A generated starter is a local draft, not persisted evidence. Keep
        // the saved side empty until the first successful artifact write.
        setSavedCode(art?.content || "");
        setSavedRevision(rev);

        // Restore local draft if one exists (B09 Requirement 2)
        try {
          const rawDraft = localStorage.getItem(`planly_draft_${activeSess.id}`);
          if (rawDraft) {
            const parsed = JSON.parse(rawDraft);
            setDraftCode(parsed.draftCode ?? codeContent);
            setMessageDraft(parsed.messageDraft ?? "");
          } else {
            setDraftCode(codeContent);
          }
        } catch {
          setDraftCode(codeContent);
        }

        // 4. Load message history and eliminate duplicates (B09-AC1)
        const history = await client.getSessionMessages(activeSess.id);
        const formatted: ChatMessage[] = history.map((m) => ({
          id: m.id,
          role: m.sender_role as "learner" | "tutor" | "system",
          content: m.content,
          artifactRevision: m.artifact_revision_snapshot || undefined,
          timestamp: m.created_at || new Date().toISOString(),
        }));
        setMessages(formatted);

        // 5. Load context packet for pending question
        try {
          const ctx: ContextPacket = await client.getSessionContext(activeSess.id);
          if (ctx.pending_question) {
            setPendingQuestion(ctx.pending_question);
          }
        } catch {
          // Context packet optional if no episodes
        }

        // 5b. Load latest execution evidence if available (B10)
        try {
          const executions = await client.getSessionExecutions(activeSess.id);
          if (executions && executions.length > 0) {
            setLatestExecution(executions[executions.length - 1]);
          }
        } catch {
          // Execution history optional
        }

        // 6. Check for in-flight run reconnect on reload (B09 Requirement 3)
        const pendingRunId = localStorage.getItem(`planly_active_run_${activeSess.id}`);
        if (pendingRunId) {
          setActiveRunId(pendingRunId);
          setIsSubmitting(true);
          setStatusNotice("Reconnecting to in-flight turn...");

          try {
            await streamRunEvents(client, pendingRunId, 0, {
              onChunk: (delta) => setStreamingText((prev) => prev + delta),
              onThinking: () => setStatusNotice("Tutor is evaluating..."),
            });
            // Re-fetch updated messages after stream completes
            const refreshed = await client.getSessionMessages(activeSess.id);
            setMessages(
              refreshed.map((m) => ({
                id: m.id,
                role: m.sender_role as "learner" | "tutor" | "system",
                content: m.content,
                artifactRevision: m.artifact_revision_snapshot || undefined,
                timestamp: m.created_at || new Date().toISOString(),
              }))
            );
          } catch (reconnectErr) {
            console.warn("Reconnect stream completed or expired:", reconnectErr);
          } finally {
            localStorage.removeItem(`planly_active_run_${activeSess.id}`);
            setActiveRunId(null);
            setIsSubmitting(false);
            setStreamingText("");
            setStatusNotice(null);
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load classroom";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [propClassroomId, propSessionId, initialTrack, client]);

  useEffect(() => {
    let ignore = false;
    async function init() {
      await Promise.resolve();
      if (ignore) return;
      await initializeClassroom();
    }
    void init();
    return () => {
      ignore = true;
    };
  }, [initializeClassroom]);

  // Explicit Save Artifact action
  const saveArtifact = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const updated = await client.putSessionArtifact(session.id, {
        content: draftCode,
        expected_revision: session.current_revision,
      });
      setSavedCode(updated.content);
      setSavedRevision(updated.revision);

      // Update session revision
      setSession((prev) => (prev ? { ...prev, current_revision: updated.revision + 1 } : null));
      return updated;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save artifact";
      setError(msg);
      throw err;
    }
  }, [client, draftCode, session]);

  // Submit Answer / Continue Action (B09 Requirement 1 & B09-AC1)
  const submitAnswer = useCallback(
    async (textOverride?: string) => {
      if (!session) return;
      const textToSubmit = textOverride !== undefined ? textOverride : messageDraft;
      if (!textToSubmit.trim() && !isDraftModified) return;

      setIsSubmitting(true);
      setError(null);
      setStreamingText("");
      setStatusNotice("Submitting to adaptive tutor...");

      let currentExpectedRevision = session.current_revision;

      // If draft code was modified, save code artifact first to ensure backend has latest revision (B09-AC2)
      if (isDraftModified) {
        try {
          const art = await client.putSessionArtifact(session.id, {
            content: draftCode,
            expected_revision: session.current_revision,
          });
          setSavedCode(art.content);
          // When save_artifact runs, session current_revision increments to art.revision + 1
          currentExpectedRevision = art.revision + 1;
          setSavedRevision(art.revision);
          setSession((prev) => (prev ? { ...prev, current_revision: currentExpectedRevision } : null));
        } catch (saveErr: unknown) {
          setIsSubmitting(false);
          setStatusNotice(null);
          const msg = saveErr instanceof Error ? saveErr.message : "Revision conflict saving code";
          setError(msg);
          return;
        }
      }

      // Optimistically append user message to avoid duplicate on reload
      const tempUserMsgId = `temp_user_${Date.now()}`;
      const userMsg: ChatMessage = {
        id: tempUserMsgId,
        role: "learner",
        content: textToSubmit,
        artifactRevision: currentExpectedRevision,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setMessageDraft("");

      try {
        const clientRequestId = `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const receipt = await client.postSessionMessage(session.id, {
          content: textToSubmit,
          expected_revision: currentExpectedRevision,
          client_request_id: clientRequestId,
          auto_execute: true,
        });
        localStorage.setItem(`planly_active_run_${session.id}`, receipt.run_id);
        setActiveRunId(receipt.run_id);

        const streamed = await streamRunEvents(client, receipt.run_id, 0, {
          onThinking: () => setStatusNotice("Tutor is evaluating..."),
          onDecision: (decision) => {
            if (typeof decision.discriminating_probe === "string") {
              setPendingQuestion(decision.discriminating_probe);
            }
          },
          onChunk: (delta) => setStreamingText((prev) => prev + delta),
        });
        if (streamed.status.state === "failed") {
          throw new Error(streamed.status.error || "Tutor run failed");
        }
        const refreshed = await client.getSessionMessages(session.id);
        setMessages(refreshed.map((m) => ({
          id: m.id,
          role: m.sender_role as "learner" | "tutor" | "system",
          content: m.content,
          artifactRevision: m.artifact_revision_snapshot || undefined,
          timestamp: m.created_at || new Date().toISOString(),
        })));

        // Clear local draft message
        try {
          localStorage.removeItem(`planly_draft_${session.id}`);
          localStorage.removeItem(`planly_active_run_${session.id}`);
        } catch {}
      } catch (submitErr: unknown) {
        const msg = submitErr instanceof Error ? submitErr.message : "Error receiving tutor feedback";
        setError(msg);
        // Do not lose the draft on error! (B09 Requirement 3)
        setMessageDraft(textToSubmit);
      } finally {
        setIsSubmitting(false);
        setStreamingText("");
        setStatusNotice(null);
      }
    },
    [client, draftCode, isDraftModified, messageDraft, session]
  );

  // Verified Code Execution (B10)
  const runTests = useCallback(
    async (codeOverride?: string) => {
      if (!session) return;
      setIsExecuting(true);
      setError(null);

      try {
        let executionRevision = savedRevision;

        // If draft code was modified and no explicit override given, auto-save artifact first
        if (isDraftModified && codeOverride === undefined) {
          try {
            const art = await client.putSessionArtifact(session.id, {
              content: draftCode,
              expected_revision: session.current_revision,
            });
            setSavedCode(art.content);
            executionRevision = art.revision;
            setSavedRevision(executionRevision);
            setSession((prev) => (prev ? { ...prev, current_revision: executionRevision + 1 } : null));
          } catch (saveErr: unknown) {
            // If conflict, proceed with codeOverride = draftCode
          }
        }

        const resp = await client.executeSessionCode(session.id, {
          revision: executionRevision,
          code_override: codeOverride !== undefined ? codeOverride : (isDraftModified ? draftCode : undefined),
        });

        setLatestExecution(resp.execution);
        return resp;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Test execution failed";
        setError(msg);
        throw err;
      } finally {
        setIsExecuting(false);
      }
    },
    [client, draftCode, isDraftModified, savedRevision, session]
  );

  return {
    classroom,
    session,
    messages,
    pendingQuestion,
    // Code
    draftCode,
    setDraftCode,
    savedCode,
    savedRevision,
    isDraftModified,
    saveArtifact,
    // Execution (B10)
    latestExecution,
    isExecuting,
    runTests,
    // Chat
    messageDraft,
    setMessageDraft,
    submitAnswer,
    // States
    isLoading,
    isSubmitting,
    streamingText,
    statusNotice,
    error,
    refresh: initializeClassroom,
  };
}
