"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useClassroomChat } from "../hooks/use-classroom-chat";
import { SubjectNav } from "./subject-nav";
import { CodeEditor } from "./code-editor";
import { ExecutionPanel } from "../execution";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  Loader2,
  Bot,
  User,
  HelpCircle,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  CheckCircle2,
} from "lucide-react";

interface ClassroomViewProps {
  classroomId?: string;
  sessionId?: string;
  defaultTrack?: string;
}

export function ClassroomView({
  classroomId,
  sessionId,
  defaultTrack = "dsa",
}: ClassroomViewProps) {
  const [track, setTrack] = useState<string>(defaultTrack);
  const {
    classroom,
    session,
    messages,
    pendingQuestion,
    draftCode,
    setDraftCode,
    savedRevision,
    isDraftModified,
    saveArtifact,
    latestExecution,
    isExecuting,
    runTests,
    messageDraft,
    setMessageDraft,
    submitAnswer,
    isLoading,
    isSubmitting,
    streamingText,
    statusNotice,
    error,
    refresh,
  } = useClassroomChat({
    classroomId,
    sessionId,
    initialTrack: track,
  });

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll chat to bottom on new messages or streaming chunks
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  // Handle Ctrl+Enter / Cmd+Enter for quick submission (B09-AC3 keyboard accessibility)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!isSubmitting) {
        submitAnswer();
      }
    }
  };

  if (isLoading) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-[450px] p-8 text-center text-muted-foreground gap-3"
        data-testid="classroom-loading"
      >
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm font-medium">Initializing quiet classroom & restoring state...</p>
      </div>
    );
  }

  if (!session || !classroom) {
    const needsLogin = error?.includes("401") || error?.toLowerCase().includes("authentication");
    return (
      <div className="flex min-h-[450px] flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <h2 className="text-sm font-semibold">Classroom unavailable</h2>
        <p className="max-w-md text-xs text-muted-foreground">
          {error || "We could not restore an authenticated classroom session."}
        </p>
        <div className="flex gap-2">
          {needsLogin ? (
            <Link href="/login"><Button size="sm">Sign in</Button></Link>
          ) : (
            <Button size="sm" onClick={refresh}>Retry</Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] max-h-[1200px] bg-background overflow-hidden">
      {/* 1. Subject Navigation Header */}
      <SubjectNav
        currentTrack={classroom?.track || track}
        onSelectTrack={(newTrack) => {
          setTrack(newTrack);
        }}
        stage={session?.stage}
        mode={session?.mode}
      />

      {/* 2. Active Pending Question Banner (if one exists) */}
      {pendingQuestion && (
        <div
          className="flex items-center gap-2.5 px-4 py-2 bg-primary/10 border-b border-primary/20 text-xs text-primary font-medium"
          data-testid="pending-question-banner"
        >
          <HelpCircle className="w-4 h-4 shrink-0 text-primary" />
          <span className="shrink-0 font-bold uppercase tracking-wider text-[10px]">Active Question:</span>
          <span className="truncate">{pendingQuestion}</span>
        </div>
      )}

      {/* 3. Error Banner */}
      {error && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5 bg-destructive/10 border-b border-destructive/20 text-xs text-destructive"
          data-testid="classroom-error-banner"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={refresh}
            className="h-6 text-xs px-2 gap-1 text-destructive hover:bg-destructive/20"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </Button>
        </div>
      )}

      {/* 4. Split Work Area: Chat Conversation + Code Editor (Responsive Grid for Narrow Viewport B09-AC3) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-3 p-3 overflow-hidden">
        {/* Left Column: Chat Conversation Panel */}
        <div
          className="flex flex-col h-full rounded-lg border border-border bg-card overflow-hidden"
          data-testid="chat-panel"
        >
          {/* Panel Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40 text-xs font-semibold">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-primary" />
              <span>Adaptive Tutor Chat</span>
            </div>
            {statusNotice && (
              <span className="flex items-center gap-1.5 text-primary text-[11px] animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin" />
                {statusNotice}
              </span>
            )}
          </div>

          {/* Message Thread Scroll Area */}
          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-4 text-sm"
            data-testid="message-thread"
          >
            {messages.length === 0 && !streamingText ? (
              <div
                className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-6 gap-2"
                data-testid="empty-chat-state"
              >
                <Sparkles className="w-8 h-8 text-muted-foreground/60" />
                <h4 className="font-medium text-foreground text-sm">Quiet Classroom Ready</h4>
                <p className="text-xs max-w-sm">
                  Write your invariant reasoning, submit an answer, or ask a question.
                  The tutor adapts to your verified learner evidence.
                </p>
              </div>
            ) : (
              messages.map((m) => {
                const isUser = m.role === "learner";
                return (
                  <div
                    key={m.id}
                    className={`flex items-start gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}
                    data-testid={`message-${m.role}`}
                  >
                    {!isUser && (
                      <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-4 h-4" />
                      </div>
                    )}
                    <div
                      className={`rounded-lg px-3.5 py-2.5 max-w-[85%] whitespace-pre-wrap leading-relaxed ${
                        isUser
                          ? "bg-primary text-primary-foreground font-normal"
                          : "bg-muted/70 text-card-foreground border border-border"
                      }`}
                    >
                      {m.content}
                      {m.artifactRevision && (
                        <div className="mt-1 text-[10px] opacity-75">
                          Referenced code rev {m.artifactRevision}
                        </div>
                      )}
                    </div>
                    {isUser && (
                      <div className="w-7 h-7 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center shrink-0 mt-0.5">
                        <User className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Live Streaming Response Bubble */}
            {streamingText && (
              <div className="flex items-start gap-2.5 justify-start" data-testid="streaming-bubble">
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="rounded-lg px-3.5 py-2.5 max-w-[85%] bg-muted/70 text-card-foreground border border-border whitespace-pre-wrap leading-relaxed">
                  {streamingText}
                  <span className="inline-block w-1.5 h-3 ml-1 bg-primary animate-pulse" />
                </div>
              </div>
            )}
          </div>

            {/* Chat Input & One Clear Submit Action (B09 Requirement 1) */}
          <div className="p-3 border-t border-border bg-card">
            <div className="flex flex-col gap-2">
              <textarea
                ref={textareaRef}
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Explain your invariant reasoning or answer the prompt (Ctrl+Enter to submit)..."
                rows={2}
                disabled={isSubmitting}
                className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                aria-label="Learner answer input"
                data-testid="learner-answer-input"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">
                  Press <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Ctrl+Enter</kbd> to submit
                </span>
                <Button
                  onClick={() => submitAnswer()}
                  disabled={isSubmitting || (!messageDraft.trim() && !isDraftModified)}
                  size="sm"
                  className="gap-1.5 h-8 px-4 font-medium"
                  data-testid="submit-answer-btn"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Continue</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Code Editor & Execution Panel */}
        <div className="flex flex-col h-full gap-3 overflow-hidden">
          <div className="flex-1 min-h-[260px] overflow-hidden">
            <CodeEditor
              value={draftCode}
              onChange={setDraftCode}
              savedRevision={savedRevision}
              isDraftModified={isDraftModified}
              onSaveArtifact={saveArtifact}
              readOnly={!session}
            />
          </div>
          <div className="h-[280px] shrink-0 overflow-hidden">
            <ExecutionPanel
              sessionId={session?.id || ""}
              currentRevision={isDraftModified ? savedRevision + 1 : savedRevision}
              latestExecution={latestExecution}
              onExecute={runTests}
              isExecuting={isExecuting}
              disabled={!session}
              className="h-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
