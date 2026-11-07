import { test, expect } from "@playwright/test";

/**
 * Sprint B11: Real Classroom Browser E2E Test.
 * Authority: B11_dsa_pilot_gate.md section Acceptance evidence (B11-AC3)
 *
 * Enforces:
 * - B11-AC3: Browser uses real API/DB paths; fixture-based tests cannot substitute for this acceptance gate.
 * - Failure to prevent: A green mock suite is not a release. If backend/provider access is absent,
 *   mark this gate BLOCKED/NOT_RUN and keep independent work moving. Never fake a mock pass.
 */

const BACKEND_URL = process.env.NEXT_PUBLIC_LEARNING_API_URL || "http://127.0.0.1:8000";

function createDevToken(ownerId: string = "dev-owner-001", email: string = "dev@localhost"): string {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: ownerId,
    email,
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 86400,
  };
  const b64 = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${b64(header)}.${b64(payload)}.dummy_sig_planly_dev`;
}

test.describe("Sprint B11: Adaptive DSA Vertical Slice Browser Journey (B11-AC3)", () => {
  // Unique IDs per run: the backend session is append-only shared state, so
  // fixed IDs let concurrent/previous runs interleave messages and make the
  // reload-equality assertion order-dependent. Still 100% real backend/API.
  let classroomId = "";
  let sessionId = "";

  test.beforeEach(async () => {
    // Check if real FastAPI backend is reachable
    let backendReachable = false;
    try {
      const resp = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (resp.ok) {
        backendReachable = true;
      }
    } catch {
      backendReachable = false;
    }

    if (!backendReachable) {
      test.skip(
        true,
        "B11-AC3 BLOCKED / NOT_RUN: Real FastAPI learning service at " +
          BACKEND_URL +
          " is offline. B11-AC3 strictly forbids replacing the real service with fixture mocks."
      );
      return;
    }

    // Seed test classroom and session in the live backend (unique per run)
    const token = createDevToken();
    const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    classroomId = `cls_dsa_pilot_e2e_${suffix}`;
    sessionId = `sess_cls_dsa_pilot_e2e_${suffix}`;
    try {
      await fetch(`${BACKEND_URL}/api/classrooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: classroomId,
          track: "dsa",
          title: "DSA: Inward Convergence (Two Sum)",
        }),
      });
      await fetch(`${BACKEND_URL}/api/classrooms/${classroomId}/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: sessionId,
          stage: "foundation",
          mode: "learn",
        }),
      });
    } catch {
      // Seeding attempt completed
    }
  });

  test("runs full real DSA pilot journey: load classroom, submit invariant reasoning, verify reload state", async ({
    page,
  }) => {

    // 1. Navigate to real classroom page
    await page.goto(`/classrooms/${classroomId}`);

    // Verify activity header and conversation container render
    const conversation = page.locator('[data-testid="conversation-container"]');
    await expect(conversation).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Two Sum II - Input Array Is Sorted" })).toBeVisible();

    // Open the on-demand editor pane, then verify it renders
    await page.locator('[data-testid="toggle-editor-btn"]').click();
    const editorPane = page.locator('[data-testid="editor-pane"]');
    await expect(editorPane).toBeVisible();

    // 2. Submit learner answer to pending Two Pointers question
    const chatInput = page.locator('[data-testid="chat-input-textarea"]');
    await expect(chatInput).toBeVisible();
    await chatInput.fill(
      "Because the array is sorted in non-decreasing order, moving the left pointer rightward increases the sum."
    );

    const submitBtn = page.locator('[data-testid="submit-turn-btn"]');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // 3. Verify real turn initiates and completes
    // Learner message appears in the conversation
    const learnerMessages = page.locator('[data-testid="message-learner"]');
    await expect(learnerMessages.last()).toContainText("Because the array is sorted");

    // Wait for tutor response or streaming completion
    const tutorMessages = page.locator('[data-testid="message-tutor"]');
    await expect(tutorMessages.first()).toBeVisible({ timeout: 15000 });

    // 4. Verify reload state recovery without duplication
    const initialCount = await page.locator('[data-testid^="message-"]').count();
    await page.reload();

    await expect(page.locator('[data-testid="conversation-container"]')).toBeVisible();
    const afterReloadCount = await page.locator('[data-testid^="message-"]').count();
    expect(afterReloadCount).toBe(initialCount);
  });
});
