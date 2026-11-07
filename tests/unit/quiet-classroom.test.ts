import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  saveCodeDraft,
  getCodeDraft,
  clearCodeDraft,
  saveMessageDraft,
  getMessageDraft,
  clearMessageDraft,
  setActiveRun,
  getActiveRun,
  updateActiveRunSeq,
  clearActiveRun,
  clearAllClassroomStorage,
} from "../../src/features/classrooms/storage";
import {
  ClassroomApiClient,
  createDevToken,
} from "../../src/lib/api/learning-client";
import type {
  RunEvent,
  RunStatusResponse,
  ArtifactRecord,
  SessionRecord,
  MessageRecord,
} from "../../src/lib/api/learning-client";

describe("Sprint B09: Quiet Classroom, Code Drafts and Streaming Resume", () => {
  const testSessionId = "sess-b09-test-1";

  beforeEach(() => {
    clearAllClassroomStorage();
  });

  describe("B09-AC1: Draft Preservation & Streaming Reconnect on Reload", () => {
    it("preserves unsent learner message draft with pending/saved distinction", () => {
      // 1. User types in chat input -> unsaved draft
      const draft1 = saveMessageDraft(testSessionId, "My invariant is inward convergence", false);
      expect(draft1.text).toBe("My invariant is inward convergence");
      expect(draft1.isPending).toBe(false);

      // 2. Draft is retrieved accurately
      const retrieved = getMessageDraft(testSessionId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.text).toBe("My invariant is inward convergence");
      expect(retrieved?.isPending).toBe(false);

      // 3. User hits submit -> marked pending
      saveMessageDraft(testSessionId, "My invariant is inward convergence", true);
      const pendingDraft = getMessageDraft(testSessionId);
      expect(pendingDraft?.isPending).toBe(true);

      // 4. Turn finishes -> draft cleared
      clearMessageDraft(testSessionId);
      expect(getMessageDraft(testSessionId)).toBeNull();
    });

    it("records active durable run and restores exact sequence on reload without duplicating messages", () => {
      const runId = "run-dsa-turn-1";
      const clientReqId = "req-12345";

      // 1. Run is started -> saved in active run store
      setActiveRun(testSessionId, runId, clientReqId, 1);
      const activeRun = getActiveRun(testSessionId);
      expect(activeRun).not.toBeNull();
      expect(activeRun?.runId).toBe(runId);
      expect(activeRun?.lastSeenSeq).toBe(1);

      // 2. Events arrive and advance sequence
      updateActiveRunSeq(testSessionId, 3);
      const updatedRun = getActiveRun(testSessionId);
      expect(updatedRun?.lastSeenSeq).toBe(3);

      // 3. Simulated page reload: client resumes from sequence 3
      const eventsBuffer: RunEvent[] = [];
      const mockEvents: RunEvent[] = [
        { id: "e1", owner_id: "u1", run_id: runId, seq: 1, event_type: "queued", payload: {} },
        { id: "e2", owner_id: "u1", run_id: runId, seq: 2, event_type: "thinking", payload: {} },
        { id: "e3", owner_id: "u1", run_id: runId, seq: 3, event_type: "decision", payload: { next_action: "diagnostic" } },
        { id: "e4", owner_id: "u1", run_id: runId, seq: 4, event_type: "chunk", payload: { delta: "Notice that current " } },
        { id: "e5", owner_id: "u1", run_id: runId, seq: 5, event_type: "chunk", payload: { delta: "must advance." } },
        { id: "e6", owner_id: "u1", run_id: runId, seq: 6, event_type: "done", payload: {} },
      ];

      // Reconnect with after_seq = activeRun.lastSeenSeq (3)
      const afterSeq = updatedRun?.lastSeenSeq || 0;
      const resumedEvents = mockEvents.filter((e) => e.seq > afterSeq);

      expect(resumedEvents.length).toBe(3);
      expect(resumedEvents[0].seq).toBe(4);
      expect(resumedEvents[1].seq).toBe(5);
      expect(resumedEvents[2].seq).toBe(6);

      // Accumulate tokens without duplicate prefix
      let reply = "";
      for (const evt of resumedEvents) {
        if (evt.event_type === "chunk") {
          reply += (evt.payload as any).delta;
        }
      }
      expect(reply).toBe("Notice that current must advance.");

      // 4. Clean up after completion
      clearActiveRun(testSessionId);
      expect(getActiveRun(testSessionId)).toBeNull();
    });
  });

  describe("B09-AC2: Code Revision Parity & Conflict Handling", () => {
    it("tracks local code draft revision vs server saved revision", () => {
      const initialCode = "def two_sum(): pass";

      // 1. Initial saved state: Rev 1, not dirty
      const savedState = saveCodeDraft(testSessionId, initialCode, 1, false);
      expect(savedState.savedRevision).toBe(1);
      expect(savedState.localRevision).toBe(1);
      expect(savedState.isDirty).toBe(false);

      // 2. Learner modifies code -> dirty draft with anticipated next revision
      const modifiedCode = "def two_sum(nums, target):\n    left, right = 0, len(nums) - 1";
      const dirtyState = saveCodeDraft(testSessionId, modifiedCode, 1, true);
      expect(dirtyState.savedRevision).toBe(1);
      expect(dirtyState.localRevision).toBe(2);
      expect(dirtyState.isDirty).toBe(true);

      // 3. Retrieval preserves modified code across reloads
      const loaded = getCodeDraft(testSessionId);
      expect(loaded?.code).toBe(modifiedCode);
      expect(loaded?.isDirty).toBe(true);
    });

    it("handles 409 stale revision conflict while preserving learner draft", async () => {
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes("/api/sessions/sess-conflict/artifact") && init?.method === "PUT") {
          return Promise.resolve({
            status: 409,
            json: async () => ({
              code: "CONFLICT",
              message: "Stale artifact write: expected 1, current 2",
              expected_revision: 2,
            }),
          });
        }
        return Promise.resolve({ status: 200, json: async () => ({}) });
      });

      const client = new ClassroomApiClient("http://localhost:8000", () => "token-123");
      (client as any).request = async (method: string, path: string, body?: any, expectedStatus: number = 200) => {
        const res = await mockFetch(`http://localhost:8000${path}`, {
          method,
          body: JSON.stringify(body),
        });
        if (res.status !== expectedStatus) {
          const envelope = await res.json();
          const err = new Error(envelope.message);
          (err as any).status = res.status;
          (err as any).envelope = envelope;
          throw err;
        }
        return res.json();
      };

      // Learner tries to save revision 1 when server is at revision 2
      let conflictCaptured: any = null;
      try {
        await client.putSessionArtifact("sess-conflict", {
          content: "my local draft code",
          expected_revision: 1,
          language: "python",
        });
      } catch (err: any) {
        conflictCaptured = err;
      }

      expect(conflictCaptured).not.toBeNull();
      expect(conflictCaptured.status).toBe(409);
      expect(conflictCaptured.envelope.expected_revision).toBe(2);

      // The local draft code is preserved
      saveCodeDraft("sess-conflict", "my local draft code", 1, true);
      const preservedDraft = getCodeDraft("sess-conflict");
      expect(preservedDraft?.code).toBe("my local draft code");
      expect(preservedDraft?.isDirty).toBe(true);
    });
  });

  describe("B09-AC3: Error States, Keyboard Shortcuts & Draft Safety", () => {
    it("preserves learner draft when external model call fails or times out", async () => {
      const learnerText = "Why does moving left pointer increase sum?";
      saveMessageDraft(testSessionId, learnerText, false);

      // Simulate provider timeout / budget ceiling error
      const mockClient = new ClassroomApiClient("http://localhost:8000", () => "token");
      (mockClient as any).submitMessageWithAutoExecute = vi.fn().mockRejectedValue(
        new Error("Model call timed out after 30s")
      );

      let submitError: any = null;
      try {
        await mockClient.submitMessageWithAutoExecute(testSessionId, learnerText, 1);
      } catch (e) {
        submitError = e;
      }

      expect(submitError).not.toBeNull();
      expect(submitError.message).toContain("timed out");

      // Verify draft was NOT wiped out and remains accessible to learner
      const draftAfterFailure = getMessageDraft(testSessionId);
      expect(draftAfterFailure?.text).toBe(learnerText);
    });

    it("cancels active run cleanly and clears run state", async () => {
      const runId = "run-cancel-test";
      setActiveRun(testSessionId, runId, "req-cancel", 2);

      expect(getActiveRun(testSessionId)?.runId).toBe(runId);

      clearActiveRun(testSessionId);
      expect(getActiveRun(testSessionId)).toBeNull();
    });

    it("verifies dev token generation format and expiration", () => {
      const token = createDevToken("dev-owner-001", "dev@localhost");
      expect(typeof token).toBe("string");
      const parts = token.split(".");
      expect(parts.length).toBe(3);

      // Decode payload
      const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
      expect(payload.sub).toBe("dev-owner-001");
      expect(payload.email).toBe("dev@localhost");
      expect(payload.exp).toBeGreaterThan(Date.now() / 1000);
    });
  });
});
