import { redirect, notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/require-owner";
import { ClassroomApiClient, createDevToken } from "@/lib/api/learning-client";
import { createServerSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { QuietClassroom } from "@/features/classrooms/components/quiet-classroom";
import type {
  ClassroomRecord,
  SessionRecord,
  MessageRecord,
  LessonMicroGoal,
  ActivityDefinition,
  TeachingDecision,
} from "@/lib/api/learning-client";

export const dynamic = "force-dynamic";

interface ClassroomDetailPageProps {
  params: Promise<{ classroomId: string }>;
  searchParams: Promise<{ session?: string }>;
}

export default async function ClassroomDetailPage({ params, searchParams }: ClassroomDetailPageProps) {
  const { classroomId } = await params;
  const { session: requestedSessionId } = await searchParams;

  const auth = await requireOwner();
  if (!auth.ok) {
    redirect("/login");
  }

  const ownerId = auth.data.ownerId;
  const supabase = isSupabaseConfigured() ? await createServerSupabaseClient() : null;
  const { data: { session: supabaseSession } = { session: null } } = supabase
    ? await supabase.auth.getSession()
    : { data: { session: null } };
  const learningApi = new ClassroomApiClient(
    undefined,
    () => supabaseSession?.access_token ?? (!isSupabaseConfigured() ? createDevToken(ownerId, auth.data.email ?? "dev@localhost") : null)
  );

  // 1. Fetch or create classroom record
  let classroom: ClassroomRecord;
  try {
    classroom = await learningApi.getClassroom(classroomId);
  } catch (error: any) {
    if (error?.status !== 404) throw error;
    // Task/activity ids are navigation hints, not durable classroom ids.
    // Create a real owner-scoped record and use the id returned by the API.
    const selectedActivity = classroomId.startsWith("act_")
      ? await learningApi.getActivity(classroomId)
      : null;
    classroom = await learningApi.createClassroom({
      track: selectedActivity?.track ?? (classroomId.includes("cs") ? "cs" : classroomId.includes("ml") ? "ai_ml" : "dsa"),
      title: selectedActivity?.title ?? "Adaptive Classroom",
    });
  }

  // 2. Fetch or create active session
  const sessions = await learningApi.listSessions(classroom.id);
  const requestedSession = requestedSessionId ? sessions.find((item) => item.id === requestedSessionId) : undefined;
  if (requestedSessionId && !requestedSession) notFound();
  const session: SessionRecord = requestedSession
    ?? sessions.find((item) => item.status === "active")
    ?? await learningApi.createSession(classroom.id, { stage: "foundation", mode: "learn", title: classroom.title });

  // 3. Fetch session message history, artifact, micro-goals, and activity
  let messages: MessageRecord[] = [];
  let artifact: { content: string; revision: number } | null = null;
  let microGoals: LessonMicroGoal[] = [];
  let activity: ActivityDefinition | null = null;
  let decisions: TeachingDecision[] = [];

  try {
    const activityId = classroomId.startsWith("act_")
      ? classroomId
      : classroom.track === "cs"
      ? "cs_process_vs_thread"
      : classroom.track === "ai_ml"
      ? "ml_numpy_linear_regression"
      : "act_dsa_two_sum_sorted";

    const [msgRes, artRes, mgRes, actRes, decRes] = await Promise.allSettled([
      learningApi.getSessionMessages(session.id),
      learningApi.getSessionArtifact(session.id),
      learningApi.getMicroGoals(session.id),
      classroomId.startsWith("act_") ? learningApi.getActivity(activityId) : learningApi.getSessionActivity(session.id),
      learningApi.getSessionDecisions(session.id),
    ]);

    if (msgRes.status === "fulfilled") messages = msgRes.value;
    if (artRes.status === "fulfilled" && artRes.value) {
      artifact = {
        content: artRes.value.content,
        revision: artRes.value.revision,
      };
    }
    if (mgRes.status === "fulfilled") microGoals = mgRes.value;
    if (actRes.status === "fulfilled") activity = actRes.value;
    else throw actRes.reason;
    if (decRes.status === "fulfilled") decisions = decRes.value;
  } catch (error) {
    throw error;
  }

  return (
    <QuietClassroom
      classroom={classroom}
      initialSession={session}
      initialMessages={messages}
      initialArtifact={artifact}
      initialMicroGoals={microGoals}
      activity={activity}
      initialDecisions={decisions}
    />
  );
}
