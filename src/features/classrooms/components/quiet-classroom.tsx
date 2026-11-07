"use client";

/**
 * Quiet Classroom Component.
 * Sprint: B09
 * Authority: planly_architecture.md sections 1, 4, 8, 13
 *
 * Acceptance Criteria Enforced:
 * - B09-AC1: Real adaptive DSA chat: import/resume, submit answer, receive adapted feedback,
 *            reload without duplicate messages.
 * - B09-AC2: Code revision in UI matches artifact revision submitted to backend.
 * - B09-AC3: Keyboard focus, empty/loading/error states and long replies usable on narrow viewport.
 * - Failure to prevent: No simulated progress cards, giant dashboard or mandatory one-file workflow.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Send,
  Code2,
  MessageSquare,
  Sparkles,
  AlertCircle,
  Brain,
  RefreshCw,
  XCircle,
  Lightbulb,
  Check,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TutorMarkdown } from "@/components/markdown";
import { MemoryDrawer } from "./memory-drawer";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { ClassroomEditor } from "./classroom-editor";
import { ExecutionPanel, useArtifactExecution } from "../execution";
import {
  learningApi,
  type ClassroomApiClient,
} from "@/lib/api/learning-client";
import {
  getCodeDraft,
  saveCodeDraft,
  getMessageDraft,
  saveMessageDraft,
  clearMessageDraft,
  getActiveRun,
  setActiveRun,
  clearActiveRun,
  updateActiveRunSeq,
} from "../storage";
import type {
  ClassroomRecord,
  SessionRecord,
  MessageRecord,
  LessonMicroGoal,
  ActivityDefinition,
  TeachingDecision,
} from "@/lib/api/learning-client";

interface QuietClassroomProps {
  classroom: ClassroomRecord;
  initialSession: SessionRecord;
  initialMessages?: MessageRecord[];
  initialArtifact?: { content: string; revision: number } | null;
  initialMicroGoals?: LessonMicroGoal[];
  activity?: ActivityDefinition | null;
  initialDecisions?: TeachingDecision[];
}

export function QuietClassroom({
  classroom,
  initialSession,
  initialMessages = [],
  initialArtifact = null,
  initialMicroGoals = [],
  activity = null,
  initialDecisions = [],
}: QuietClassroomProps) {
  const router = useRouter();
  // Session & revision state
  const [session, setSession] = useState<SessionRecord>(initialSession);
  const [messages, setMessages] = useState<MessageRecord[]>(initialMessages);
  const [microGoals, setMicroGoals] = useState<LessonMicroGoal[]>(initialMicroGoals);

  // Code editor state (B09-AC2)
  const defaultCode =
    initialArtifact?.content ?? activity?.starter_code ?? "";

  const [code, setCode] = useState<string>(() => {
    const draft = getCodeDraft(initialSession.id);
    return draft ? draft.code : defaultCode;
  });

  const [savedRevision, setSavedRevision] = useState<number>(
    initialArtifact?.revision ?? initialSession.current_revision
  );
  const [isCodeDirty, setIsCodeDirty] = useState<boolean>(() => {
    const draft = getCodeDraft(initialSession.id);
    // A generated starter is not a persisted artifact. It must not render as
    // "Saved" until the owner writes it through the API.
    return draft ? draft.isDirty : !initialArtifact;
  });
  const [isSavingCode, setIsSavingCode] = useState<boolean>(false);
  const [conflictRevision, setConflictRevision] = useState<number | null>(null);

  // Message input & streaming state
  const [inputMessage, setInputMessage] = useState<string>(() => {
    const draft = getMessageDraft(initialSession.id);
    return draft?.text ?? "";
  });
  const initialActiveRun = getActiveRun(initialSession.id);
  const [activeRunId, setActiveRunId] = useState<string | null>(
    initialActiveRun?.runId ?? null
  );
  const [isRunning, setIsRunning] = useState<boolean>(
    Boolean(initialActiveRun?.runId)
  );
  const [runStage, setRunStage] = useState<"idle" | "thinking" | "decision" | "streaming">(
    initialActiveRun?.runId ? "streaming" : "idle"
  );
  const [streamingText, setStreamingText] = useState<string>("");
  const [activeDecision, setActiveDecision] = useState<TeachingDecision | null>(
    initialDecisions.length > 0 ? initialDecisions[initialDecisions.length - 1] : null
  );
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(
    null
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync draft message if session changes
  const [prevSessionId, setPrevSessionId] = useState(session.id);
  if (session.id !== prevSessionId) {
    setPrevSessionId(session.id);
    const draft = getMessageDraft(session.id);
    setInputMessage(draft?.text ?? "");
  }

  // Responsive layout state (B09-AC3)
  const [showEditor, setShowEditor] = useState<boolean>(false);
  const [mobileTab, setMobileTab] = useState<"discussion" | "code">("discussion");
  const [memoryOpen, setMemoryOpen] = useState<boolean>(false);
  const [endOpen, setEndOpen] = useState<boolean>(false);

  // Verified Python Execution & Test Runner State (B10)
  const {
    latestExecution,
    isExecuting: isExecutingCode,
    executeCode,
  } = useArtifactExecution({
    sessionId: session.id,
    currentRevision: savedRevision,
    testSuiteId: activity?.id,
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unsubscribeRunRef = useRef<(() => void) | null>(null);

  // Auto-scroll to bottom of conversation
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, runStage, scrollToBottom]);

  // Keyboard focus management (B09-AC3)
  useEffect(() => {
    if (!isRunning && mobileTab === "discussion") {
      textareaRef.current?.focus();
    }
  }, [isRunning, mobileTab]);

  // Reload Reconnect to Active Run (B09-AC1)
  useEffect(() => {
    const savedActiveRun = getActiveRun(session.id);
    if (savedActiveRun && savedActiveRun.runId) {
      // Subscribe from last seen sequence
      const unsubscribe = learningApi.subscribeToRunEvents(
        savedActiveRun.runId,
        savedActiveRun.lastSeenSeq,
        {
          onEvent: (evt) => {
            updateActiveRunSeq(session.id, evt.seq);
            if (evt.event_type === "thinking") {
              setRunStage("thinking");
            } else if (evt.event_type === "decision") {
              setRunStage("decision");
              setActiveDecision(evt.payload as unknown as TeachingDecision);
            } else if (evt.event_type === "chunk") {
              setRunStage("streaming");
              const delta = (evt.payload as any)?.delta || "";
              setStreamingText((prev) => prev + delta);
            }
          },
          onComplete: (statusRes) => {
            if (statusRes.decision) {
              setActiveDecision(statusRes.decision);
            }
            // Fetch latest messages from server to guarantee 0 duplicates
            learningApi.getSessionMessages(session.id).then((freshMessages) => {
              if (freshMessages.length > 0) {
                setMessages(freshMessages);
              }
            });
            setIsRunning(false);
            setRunStage("idle");
            setStreamingText("");
            setActiveRunId(null);
            clearActiveRun(session.id);
            clearMessageDraft(session.id);
          },
          onError: (err) => {
            setErrorMessage(`Reconnected run failed: ${err.message}`);
            setIsRunning(false);
            setRunStage("idle");
            clearActiveRun(session.id);
          },
        }
      );

      unsubscribeRunRef.current = unsubscribe;
      return () => {
        unsubscribe();
      };
    }
  }, [session.id]);

  // Pending questions are evidence-backed state, never a client-side default.
  useEffect(() => {
    learningApi.getSessionContext(session.id)
      .then((context) => setPendingQuestion(context.pending_question ?? null))
      .catch(() => setPendingQuestion(null));
  }, [session.id]);

  // Code editor change & draft saving
  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    setIsCodeDirty(true);
    saveCodeDraft(session.id, newCode, savedRevision, true);
  };

  // Save Code Artifact (B09-AC2)
  const handleSaveArtifact = async () => {
    setIsSavingCode(true);
    setErrorMessage(null);
    try {
      const art = await learningApi.putSessionArtifact(session.id, {
        content: code,
        expected_revision: session.current_revision,
        language: "python",
      });
      // Revision parity verified
      setSavedRevision(art.revision);
      setIsCodeDirty(false);
      setConflictRevision(null);
      saveCodeDraft(session.id, code, art.revision, false);

      // Advance session revision in local state
      setSession((prev: SessionRecord) => ({
        ...prev,
        current_revision: art.revision + 1,
      }));
    } catch (err: any) {
      if (err.status === 409 || err.envelope?.code === "CONFLICT") {
        const expectedRev = err.envelope?.expected_revision || session.current_revision + 1;
        setConflictRevision(expectedRev);
      } else {
        setErrorMessage(`Failed to save code: ${err.message}`);
      }
    } finally {
      setIsSavingCode(false);
    }
  };

  // Conflict resolution handler
  const handleResolveConflict = async (keepLocal: boolean) => {
    if (!keepLocal) {
      // Reload server artifact
      try {
        const serverArt = await learningApi.getSessionArtifact(session.id);
        if (serverArt) {
          setCode(serverArt.content);
          setSavedRevision(serverArt.revision);
          setIsCodeDirty(false);
          setConflictRevision(null);
          saveCodeDraft(session.id, serverArt.content, serverArt.revision, false);
          setSession((prev: SessionRecord) => ({
            ...prev,
            current_revision: serverArt.revision + 1,
          }));
        }
      } catch (e) {
        setErrorMessage("Failed to reload server code.");
      }
    } else {
      // Overwrite with local draft using the server's current expected revision
      if (conflictRevision) {
        try {
          const art = await learningApi.putSessionArtifact(session.id, {
            content: code,
            expected_revision: conflictRevision,
            language: "python",
          });
          setSavedRevision(art.revision);
          setIsCodeDirty(false);
          setConflictRevision(null);
          saveCodeDraft(session.id, code, art.revision, false);
          setSession((prev: SessionRecord) => ({
            ...prev,
            current_revision: art.revision + 1,
          }));
        } catch (e: any) {
          setErrorMessage(`Failed to overwrite revision: ${e.message}`);
        }
      }
    }
  };

  // Submit Answer / Continue Turn (B09-AC1)
  const handleSubmitMessage = async () => {
    const text = inputMessage.trim();
    if (!text || isRunning) return;

    // Bind the queued turn to the artifact the learner is actually sending.
    // Saving uses the session concurrency revision, while the editor badge
    // continues to display the artifact revision returned by the server.
    let turnRevision = session.current_revision;
    if (isCodeDirty) {
      try {
        const art = await learningApi.putSessionArtifact(session.id, {
          content: code,
          expected_revision: session.current_revision,
          language: "python",
        });
        setSavedRevision(art.revision);
        turnRevision = art.revision + 1;
        setIsCodeDirty(false);
        saveCodeDraft(session.id, code, art.revision, false);
        setSession((prev) => ({ ...prev, current_revision: art.revision + 1 }));
      } catch (err: any) {
        setErrorMessage(`Save code before submitting: ${err.message}`);
        return;
      }
    }

    setErrorMessage(null);
    setIsRunning(true);
    setRunStage("thinking");
    setStreamingText("");

    // Retain unsent message draft locally
    saveMessageDraft(session.id, text, true);

    // Optimistically add learner message
    const learnerMsg: MessageRecord = {
      id: `local-${Date.now()}`,
      owner_id: session.owner_id,
      session_id: session.id,
      sender_role: "learner",
      content: text,
      artifact_revision_snapshot: turnRevision,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, learnerMsg]);
    setInputMessage("");

    try {
      // Submit to durable queue with auto_execute = true
      const clientReqId = `req-${Date.now()}`;
      const receipt = await learningApi.submitMessageWithAutoExecute(
        session.id,
        text,
        turnRevision,
        clientReqId
      );

      setActiveRunId(receipt.run_id);
      setActiveRun(session.id, receipt.run_id, clientReqId, 0);

      // Stream events from durable run
      let accumulatedReply = "";
      const unsubscribe = learningApi.subscribeToRunEvents(
        receipt.run_id,
        0,
        {
          onEvent: (evt) => {
            updateActiveRunSeq(session.id, evt.seq);
            if (evt.event_type === "thinking") {
              setRunStage("thinking");
            } else if (evt.event_type === "decision") {
              setRunStage("decision");
              setActiveDecision(evt.payload as unknown as TeachingDecision);
            } else if (evt.event_type === "chunk") {
              setRunStage("streaming");
              const delta = (evt.payload as any)?.delta || "";
              accumulatedReply += delta;
              setStreamingText(accumulatedReply);
            }
          },
          onComplete: (statusRes) => {
            if (statusRes.decision) {
              setActiveDecision(statusRes.decision);
            }
            // Reconcile with server truth (same as reload-reconnect path):
            // replace the optimistic learner bubble + streamed text with the
            // persisted history so a refresh can never show a different count.
            // Falls back to the local append if the fetch fails.
            learningApi
              .getSessionMessages(session.id)
              .then((freshMessages) => {
                if (freshMessages.length > 0) {
                  setMessages(freshMessages);
                } else {
                  appendLocalTutorReply();
                }
              })
              .catch(() => appendLocalTutorReply())
              .finally(() => {
                setStreamingText("");
                setIsRunning(false);
                setRunStage("idle");
                setActiveRunId(null);
                clearActiveRun(session.id);
                clearMessageDraft(session.id);

                // Refocus input for next turn
                requestAnimationFrame(() => {
                  textareaRef.current?.focus();
                });
              });

            function appendLocalTutorReply() {
              const finalReply = accumulatedReply || "Turn completed.";
              const tutorMsg: MessageRecord = {
                id: `tutor-${receipt.run_id}`,
                owner_id: session.owner_id,
                session_id: session.id,
                sender_role: "tutor",
                content: finalReply,
                artifact_revision_snapshot: session.current_revision,
                created_at: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, tutorMsg]);
            }
          },
          onError: (err) => {
            // Error occurred: retain message text draft so work is not lost
            setErrorMessage(`Tutor execution error: ${err.message}. Your answer draft was preserved.`);
            setInputMessage(text);
            saveMessageDraft(session.id, text, false);
            setIsRunning(false);
            setRunStage("idle");
            clearActiveRun(session.id);
          },
        }
      );

      unsubscribeRunRef.current = unsubscribe;
    } catch (err: any) {
      setErrorMessage(`Failed to send message: ${err.message}. Draft preserved.`);
      setInputMessage(text);
      saveMessageDraft(session.id, text, false);
      setIsRunning(false);
      setRunStage("idle");
    }
  };

  const handleReturnToCoach = async () => {
    if (!session.parent_session_id || isRunning || isExecutingCode) return;
    try {
      await learningApi.completeLesson(session.id, {
        title: session.title || classroom.title || "Focused lesson",
        status: "checkpoint",
        summary: pendingQuestion
          ? `Checkpoint returned with an active question: ${pendingQuestion}`
          : "Return to coach with a saved lesson checkpoint.",
        demonstrated_skills: [],
        misconceptions: [],
        next_recommendation: pendingQuestion || "Choose the next focused lesson from your coach.",
      });
      router.push("/coach");
    } catch (err: any) {
      setErrorMessage(`Could not return this lesson to your coach: ${err.message}`);
    }
  };

  // Cancel active run
  const handleCancelRun = async () => {
    if (!activeRunId) return;
    if (unsubscribeRunRef.current) {
      unsubscribeRunRef.current();
    }
    try {
      await learningApi.cancelRun(activeRunId);
    } catch {}
    clearActiveRun(session.id);
    setIsRunning(false);
    setRunStage("idle");
    setActiveRunId(null);
    setStreamingText("");
  };

  // Keyboard: M toggles memory (E toggles editor) — no animation on keyboard open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        setMemoryOpen((v) => !v);
      }
      if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        setShowEditor((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-[calc(100dvh-116px)] flex-col overflow-hidden bg-background md:h-[calc(100dvh-60px)]">
      {/* 1. Classroom Top Navigation Header */}
      <header className="glass flex shrink-0 items-center justify-between border-b border-border bg-surface px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            href={session.parent_session_id ? "/coach" : "/classrooms"}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted transition hover:bg-surface-hover hover:text-foreground"
            title={session.parent_session_id ? "Return to learning coach" : "All classrooms"}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-display text-[19px] font-medium tracking-[-0.018em] text-foreground sm:text-[21px]">
                {classroom.title || "DSA: Inward Convergence"}
              </h1>
              <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-strong">
                Learn · {session.mode || "mode"}
              </span>
            </div>
              <p className="mt-0.5 font-mono text-[11px] text-muted">
              {session.parent_session_id ? "Focused lesson · returns a learning handoff to your coach" : activity?.title ?? "Activity loading from the assigned classroom"}
            </p>
          </div>
        </div>

        {/* View Toggle on Desktop and Mobile */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMemoryOpen(true)}
            className="hidden gap-2 sm:flex"
            data-testid="open-memory-btn"
            aria-label="Open memory and history"
          >
            <Brain className="h-3.5 w-3.5" />
            <span>Memory</span>
            <kbd className="kbd">M</kbd>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMemoryOpen(true)}
            className="gap-2 sm:hidden"
            data-testid="open-memory-btn-mobile"
            aria-label="Open memory and history"
          >
            <Brain className="h-3.5 w-3.5" />
          </Button>
          {/* Mobile switcher (<768px) */}
          <div className="flex rounded-lg border border-border bg-surface-hover p-0.5 md:hidden">
            <button
              onClick={() => setMobileTab("discussion")}
              className={`pressable flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${
                mobileTab === "discussion"
                  ? "bg-foreground text-background shadow-xs"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Chat</span>
            </button>
            <button
              onClick={() => setMobileTab("code")}
              className={`pressable flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${
                mobileTab === "code"
                  ? "bg-foreground text-background shadow-xs"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Code2 className="h-3.5 w-3.5" />
              <span>Code</span>
              {isCodeDirty && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            </button>
          </div>

          {/* Desktop editor toggle button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowEditor(!showEditor)}
            className="hidden gap-2 md:flex"
            data-testid="toggle-editor-btn"
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>{showEditor ? "Hide Code" : "Show Code"}</span>
            {isCodeDirty && (
              <span className="rounded border border-border bg-surface-muted px-1 font-mono text-[10px] text-muted-strong">
                Draft
              </span>
            )}
          </Button>
        </div>
      </header>

      {/* 2. Main Workspace Split: Conversation + Optional Code Editor */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left / Center Column: Conversation Thread */}
        <div
          className={`flex flex-1 flex-col overflow-hidden bg-surface/30 ${
            mobileTab === "code" ? "hidden md:flex" : "flex"
          }`}
        >
          {/* Conversation History Container */}
          <div
            data-testid="conversation-container"
            className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8"
          >
            <div className="mx-auto w-full max-w-[920px] space-y-7 pb-8">
              {/* Activity brief: enough context to orient, without competing with the lesson. */}
              <section className="border-l-2 border-primary pl-4 sm:pl-5">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
                  <Lightbulb className="h-3.5 w-3.5 text-primary" />
                  Current pattern
                </div>
                <h2 className="mt-2 font-display text-[18px] tracking-[-0.02em] text-foreground">
                  {activity?.title ?? "Two pointers · inward convergence"}
                </h2>
                <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-muted-strong">
                  Sorted input means every pointer move can safely discard a whole range. Explain the invariant before writing code.
                </p>
              </section>

              {/* Messages List */}
              {messages.map((msg, idx) => {
                const isLearner = msg.sender_role === "learner";
                return (
                  <article
                    key={msg.id || idx}
                    data-testid={`message-${msg.sender_role}`}
                    className={`msg-in flex flex-col ${isLearner ? "items-end" : "items-start"}`}
                  >
                    <div className={`mb-2 flex items-center gap-2 text-[11px] ${isLearner ? "pr-1 text-muted" : "w-full border-b border-border/70 pb-2 text-muted"}`}>
                      <span className="font-semibold uppercase tracking-[0.1em]">
                        {isLearner ? "Your reasoning" : "Planly tutor"}
                      </span>
                      {msg.created_at && (
                        <span suppressHydrationWarning>
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                    {isLearner ? (
                      <div className="max-w-[min(100%,38rem)] rounded-2xl rounded-tr-sm bg-foreground px-4 py-3 text-sm leading-relaxed text-background shadow-xs">
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ) : (
                      <div className="tutor-lesson-message w-full rounded-xl border border-border bg-surface px-5 py-5 text-foreground shadow-xs sm:px-7 sm:py-6">
                        <TutorMarkdown content={msg.content} />
                      </div>
                    )}
                  </article>
                );
              })}

            {/* Streaming / In-Progress Bubble */}
              {isRunning && (
                <div
                data-testid="streaming-bubble"
                className="flex flex-col items-start space-y-2"
              >
                  <div className="flex items-center gap-2 text-[11px] text-muted">
                  <span className="font-semibold uppercase tracking-[0.1em]">Planly Tutor</span>
                  {runStage === "thinking" && (
                    <span className="inline-flex items-center gap-1.5 text-muted-strong">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      Analyzing your invariant reasoning...
                    </span>
                  )}
                  {runStage === "decision" && (
                    <span className="rounded border border-border bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-muted-strong">
                      Pedagogical Action: {activeDecision?.next_action || "Assessing"}
                    </span>
                  )}
                </div>

                  <div className="tutor-lesson-message w-full rounded-xl border border-border bg-surface px-5 py-5 text-sm leading-relaxed text-foreground shadow-xs sm:px-7 sm:py-6">
                  {streamingText ? (
                    <><TutorMarkdown content={streamingText} /><span className="stream-caret ml-1 inline-block h-3.5 w-[2px] translate-y-[2px] bg-primary" /></>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span className="h-2 w-2 animate-ping rounded-full bg-primary" />
                      <span>Formulating targeted guidance...</span>
                    </div>
                  )}
                  </div>
                </div>
              )}

            {/* Error Banner */}
              {errorMessage && (
              <div
                data-testid="error-banner"
                className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
                <button
                  onClick={() => setErrorMessage(null)}
                  className="text-xs underline hover:opacity-80"
                >
                  Dismiss
                </button>
              </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Unanswered Active Question Callout (B08-AC2) */}
          {pendingQuestion && !isRunning && (
            <div
              data-testid="pending-question-banner"
              className="border-t border-border bg-surface px-4 py-2.5 sm:px-6"
            >
              <p className="pull-quote">
                <span className="q-label">Active question</span>
                {pendingQuestion}
              </p>
            </div>
          )}

          {/* 3. Bottom Input & Submit Bar (B09-AC3) */}
          <div className="border-t border-border bg-surface px-4 py-3 sm:px-8 sm:py-4">
            <div className="composer-glow glass relative mx-auto flex max-w-[920px] flex-col gap-2 rounded-xl border border-border bg-background p-2">
              <textarea
                ref={textareaRef}
                value={inputMessage}
                onChange={(e) => {
                  setInputMessage(e.target.value);
                  saveMessageDraft(session.id, e.target.value, false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitMessage();
                  }
                }}
                disabled={isRunning}
                data-testid="chat-input-textarea"
                aria-label="Learner answer or reasoning"
                placeholder="Explain your reasoning or ask a conceptual question... (Press Enter to submit)"
                rows={2}
                className="w-full resize-none border-none bg-transparent p-2 text-sm text-foreground outline-none placeholder:text-muted disabled:opacity-50"
              />

              <div className="flex items-center justify-between border-t border-border/50 pt-2 text-xs text-muted">
                <span className="hidden sm:inline">
                  <kbd className="kbd">Enter</kbd> to submit ·{" "}
                  <kbd className="kbd">Shift+Enter</kbd> for newline
                </span>

                <div className="flex items-center gap-2">
                  {!isRunning && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEndOpen(true)}
                      data-testid="end-session-btn"
                      className="h-8 gap-1.5 text-xs text-muted hover:text-foreground"
                    >
                      <span>End session</span>
                    </Button>
                  )}
                  {isRunning ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={handleCancelRun}
                      data-testid="cancel-turn-btn"
                      className="h-8 gap-1.5 text-xs"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>Cancel</span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={handleSubmitMessage}
                      disabled={!inputMessage.trim()}
                      data-testid="submit-turn-btn"
                      className="h-8 gap-1.5 text-xs"
                    >
                      <span>Submit Answer</span>
                      <Send className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Code Editor Pane */}
        {showEditor && (
          <div
            data-testid="editor-pane"
            className={`w-full border-l border-border md:w-[45%] lg:w-[48%] xl:w-[50%] ${
              mobileTab === "discussion" ? "hidden md:flex" : "flex"
            } flex-col`}
          >
            <ClassroomEditor
              value={code}
              language="python"
              savedRevision={savedRevision}
              isDirty={isCodeDirty}
              isSaving={isSavingCode}
              conflictRevision={conflictRevision}
              onChange={handleCodeChange}
              onSave={handleSaveArtifact}
              onResolveConflict={handleResolveConflict}
              disabled={isRunning}
            />

            {/* B10: Verified Python Test Runner & Execution Evidence Panel */}
            <div className="border-t border-border p-3 bg-surface/40">
              <ExecutionPanel
                sessionId={session.id}
                currentRevision={savedRevision}
                latestExecution={latestExecution}
                onExecute={() => executeCode(code)}
                isExecuting={isExecutingCode}
              />
            </div>
          </div>
        )}
      </div>
      <MemoryDrawer
        open={memoryOpen}
        onOpenChange={setMemoryOpen}
        pendingQuestion={pendingQuestion}
        messages={messages}
        microGoals={microGoals}
        decisions={activeDecision ? [activeDecision] : initialDecisions}
        savedRevision={savedRevision}
      />
      <Dialog open={endOpen} onOpenChange={setEndOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End this session?</DialogTitle>
            <DialogDescription>
              A checkpoint saves the pending question, artifact rev {savedRevision} and history. Resume anytime — nothing is marked mastered.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 rounded-xl border border-border bg-surface p-3.5 text-[12.5px] leading-relaxed">
            <p><span className="font-semibold">What happened — </span><span className="text-muted">{messages.length} turns · code rev {savedRevision}{isCodeDirty ? " (unsaved draft kept locally)" : ""}</span></p>
            <p><span className="font-semibold">Key lesson — </span><span className="text-muted">{pendingQuestion ?? "No open question; state is clean."}</span></p>
            <p><span className="font-semibold">Resume at — </span><span className="text-muted">{classroom.title || "this classroom"} · same question, same code</span></p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEndOpen(false)}>Keep studying</Button>
            {session.parent_session_id && <Button variant="outline" disabled={isRunning || isExecutingCode} onClick={() => void handleReturnToCoach()}>Return to coach</Button>}
            <Button
              onClick={() => {
                clearMessageDraft(session.id);
                setEndOpen(false);
                toast.success("Checkpoint saved — resume from Classrooms anytime.");
              }}
            >
              End & save checkpoint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
