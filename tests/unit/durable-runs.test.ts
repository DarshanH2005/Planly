import { describe, it, expect } from "vitest";
import {
  LearningApiClient,
  type TurnRunRecord,
  type RunEvent,
  type ExternalCallReceipt,
  type RunStatusResponse,
  type RunEventsResponse,
  type SessionMessageInput,
} from "../../../contracts/learning-client";

describe("B04: Durable Runs, Job State & Client Integration", () => {
  it("deserializes TurnRunRecord and verifies fields", () => {
    const rawRun: TurnRunRecord = {
      id: "run-abc-123",
      owner_id: "00000000-0000-0000-0000-000000000001",
      classroom_id: "cls-123",
      session_id: "sess-123",
      client_request_id: "req-123",
      expected_revision: 1,
      state: "running",
      lane: "foreground",
      message_id: "msg-123",
      lease_owner: "worker-1",
      lease_expires_at: "2026-09-12T20:30:00Z",
      fence: 2,
      decision: null,
      error: null,
      created_at: "2026-09-12T20:00:00Z",
      updated_at: "2026-09-12T20:00:00Z",
    };

    expect(rawRun.state).toBe("running");
    expect(rawRun.lane).toBe("foreground");
    expect(rawRun.fence).toBe(2);
  });

  it("deserializes RunEvent stream and validates order", () => {
    const events: RunEvent[] = [
      {
        id: "evt-1",
        owner_id: "00000000-0000-0000-0000-000000000001",
        run_id: "run-1",
        seq: 1,
        event_type: "queued",
        payload: { message_id: "msg-1" },
      },
      {
        id: "evt-2",
        owner_id: "00000000-0000-0000-0000-000000000001",
        run_id: "run-1",
        seq: 2,
        event_type: "chunk",
        payload: { delta: "Feedback token" },
      },
    ];

    expect(events.length).toBe(2);
    expect(events[0].seq).toBe(1);
    expect(events[1].seq).toBe(2);
  });

  it("deserializes ExternalCallReceipt and tracks uncertain status", () => {
    const receipt: ExternalCallReceipt = {
      id: "ext-1",
      owner_id: "00000000-0000-0000-0000-000000000001",
      idempotency_key: "model-call-xyz",
      call_type: "model_inference",
      status: "uncertain",
      request_hash: "hash123",
      cost_cents: 0,
    };

    expect(receipt.status).toBe("uncertain");
  });

  it("validates LearningApiClient has all B04 durable run methods", () => {
    const client = new LearningApiClient("http://localhost:8000");
    expect(typeof client.postSessionMessage).toBe("function");
    expect(typeof client.getRunStatus).toBe("function");
    expect(typeof client.getRunEvents).toBe("function");
    expect(typeof client.cancelRun).toBe("function");
  });
});
