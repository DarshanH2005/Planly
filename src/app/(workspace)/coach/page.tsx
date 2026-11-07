import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { ClassroomApiClient, createDevToken, type MessageRecord } from "@/lib/api/learning-client";
import { CoachWorkspace } from "@/features/coach/components/coach-workspace";

export const dynamic = "force-dynamic";

export default async function CoachPage() {
  const auth = await requireOwner();
  if (!auth.ok) redirect("/login");
  const api = new ClassroomApiClient(undefined, () => createDevToken(auth.data.ownerId, auth.data.email ?? "dev@localhost"));
  const classrooms = await api.listClassrooms();
  let coach = classrooms.find((item) => item.title === "Learning Coach");
  if (!coach) coach = await api.createClassroom({ track: "coach", title: "Learning Coach" });
  const sessions = await api.listSessions(coach.id);
  const session = sessions.find((item) => item.status === "active") ?? await api.createSession(coach.id, { stage: "foundation", mode: "learn", title: "Main learning chat" });
  const handoffs = await api.getLessonHandoffs(session.id);
  const messages: MessageRecord[] = await api.getSessionMessages(session.id);
  const memory = await api.getCoachMemory();
  const recommendation = await api.getCoachRecommendation(session.id);
  return <CoachWorkspace session={session} initialHandoffs={handoffs} initialMessages={messages} memory={memory} initialRecommendation={recommendation.recommended_lesson} />;
}
