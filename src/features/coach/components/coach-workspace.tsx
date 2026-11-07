"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, ArrowUpRight, BookOpen, Check, Compass, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { learningApi, type CoachMemory, type LessonHandoff, type MessageRecord, type SessionRecord } from "@/lib/api/learning-client";
import { TutorMarkdown } from "@/components/markdown";
import styles from "./coach-workspace.module.css";

export function CoachWorkspace({ session, initialHandoffs = [], initialMessages = [], memory = [], initialRecommendation = null }: {
  session: SessionRecord; initialHandoffs?: LessonHandoff[]; initialMessages?: MessageRecord[]; memory?: CoachMemory[]; initialRecommendation?: string | null;
}) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [messages, setMessages] = useState(initialMessages);
  const [proposedTopic, setProposedTopic] = useState<string | null>(initialRecommendation);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (pending || messages.length > initialMessages.length) end.current?.scrollIntoView({ block: "nearest" });
  }, [pending, messages.length, initialMessages.length]);

  const launch = async (chosen: string) => {
    if (!chosen.trim() || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const title = chosen.trim();
      const child = await learningApi.openCoachLesson(session.id, title);
      router.push(`/classrooms/${child.classroom_id}?session=${child.id}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "The lesson could not be opened. Please try again.");
    } finally { inFlight.current = false; setBusy(false); }
  };

  const resume = async (childId: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const child = await learningApi.getSession(childId);
      if (child.parent_session_id !== session.id) throw new Error("This lesson does not belong to the current Coach conversation.");
      router.push(`/classrooms/${encodeURIComponent(child.classroom_id)}?session=${encodeURIComponent(child.id)}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "This lesson could not be resumed.");
    } finally { inFlight.current = false; setBusy(false); }
  };

  const stayInChat = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await learningApi.dismissCoachLesson(session.id);
      setProposedTopic(null);
    } catch {
      setError("Could not dismiss this proposal. Please try again.");
    } finally { inFlight.current = false; setBusy(false); }
  };

  const send = async () => {
    const content = topic.trim();
    if (!content || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setPending(content);
    setError(null);
    try {
      const turn = await learningApi.postCoachTurn(session.id, content);
      setMessages((current) => [...current, ...turn.messages]);
      setProposedTopic(turn.recommended_lesson);
      setTopic("");
    } catch {
      setError("The Coach couldn't finish this response. Your message is still here. Check API availability in Settings, then try again.");
    } finally { setPending(null); setBusy(false); inFlight.current = false; }
  };

  return <div className={styles.workspace}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}><Compass size={14} /> MAIN CHAT</p><h1>Your learning coach</h1></div>
      <span className={styles.status}><span /> {memory.length ? "Learning history connected" : "Ready to learn"}</span>
    </header>
    <details className={styles.memory}>
      <summary><BookOpen size={16} /><span>Learning memory</span><span className={styles.memoryCount}>{memory.reduce((sum, item) => sum + item.turn_count, 0)} imported turns</span></summary>
      <div className={styles.memoryBody}>
        {memory.length ? memory.map((item) => <article key={item.id}><p className={styles.source}><Check size={14} /> {item.filename}</p><TutorMarkdown content={item.summary} /></article>) : <p>No reviewed chat history is connected yet.</p>}
      </div>
    </details>
    {initialHandoffs.length > 0 && <section aria-label="Your saved lessons" className={styles.memory}>
      <div className={styles.memoryBody}>
        <p className={styles.eyebrow}>PICK UP YOUR LESSON</p>
        {initialHandoffs.map((item) => <article key={item.id}>
          <div className={styles.proposal}>
            <div><p>{item.title}</p><span>Saved conversation · progress checked separately</span></div>
            <Button size="sm" variant="outline" disabled={busy} aria-label={`Resume ${item.title}`} onClick={() => void resume(item.child_session_id)}>Resume <ArrowUpRight size={15} /></Button>
          </div>
          <details className={styles.returns}><summary>Last checkpoint</summary><TutorMarkdown content={item.summary} /></details>
        </article>)}
      </div>
    </section>}
    <section className={styles.conversation} aria-label="Coach conversation" aria-busy={busy}>
      {messages.length === 0 && <div className={styles.empty}><h2>Pick up where you left off.</h2><p>Ask for today’s plan, revisit a mistake, or bring a problem you want to understand.</p></div>}
      {messages.map((message) => message.sender_role === "learner"
        ? <div key={message.id} className={styles.user}>{message.content}</div>
        : <article key={message.id} className={styles.assistant}><p className={styles.speaker}>Planly</p><TutorMarkdown content={message.content} /></article>)}
      {pending && <><div className={styles.user}>{pending}</div><p role="status" className={styles.thinking}><Loader2 size={16} className="animate-spin motion-reduce:animate-none" /> Reading your learning history…</p></>}
      <div ref={end} />
    </section>
    {proposedTopic && <div className={styles.proposal}><div><span>OPTIONAL FOCUSED LESSON · RESUMES EXISTING WORK IF AVAILABLE</span><p>{proposedTopic}</p></div><Button variant="ghost" size="sm" disabled={busy} onClick={() => void stayInChat()}>Stay in chat</Button><Button size="sm" onClick={() => void launch(proposedTopic)} disabled={busy}>Continue in lesson <ArrowUpRight size={15} /></Button></div>}
    <footer className={styles.composerArea}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className={styles.composer}>
        <label htmlFor="coach-topic" className="sr-only">Message your learning coach</label>
        <textarea id="coach-topic" rows={2} maxLength={3000} value={topic} onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          placeholder="Start day 5, revisit a concept, or ask a question…" disabled={busy} />
        <Button type="submit" size="icon" aria-label="Send message" disabled={!topic.trim() || busy}>{busy ? <Loader2 size={18} className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={18} />}</Button>
      </form>
      <p className={styles.composerHint}>Enter to send · Shift + Enter for a new line</p>
    </footer>
  </div>;
}
