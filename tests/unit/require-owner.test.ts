import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireOwner } from "../../src/lib/auth/require-owner";
import * as supabaseServer from "../../src/lib/supabase/server";

vi.mock("../../src/lib/supabase/server", () => ({
  isSupabaseConfigured: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));

describe("requireOwner (Sprint 01 Auth Guard)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns fallback dev owner when Supabase is not configured", async () => {
    vi.mocked(supabaseServer.isSupabaseConfigured).mockReturnValue(false);

    const result = await requireOwner();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.ownerId).toBe("dev-owner-001");
      expect(result.data.email).toBe("dev@localhost");
    }
  });

  it("returns UNAUTHENTICATED if getUser returns an error or no user", async () => {
    vi.mocked(supabaseServer.isSupabaseConfigured).mockReturnValue(true);
    vi.mocked(supabaseServer.createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: new Error("Invalid JWT"),
        }),
      },
      from: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof supabaseServer.createServerSupabaseClient>>);

    const result = await requireOwner();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNAUTHENTICATED");
    }
  });

  it("fails closed with FORBIDDEN if user is not in owner allowlist", async () => {
    vi.mocked(supabaseServer.isSupabaseConfigured).mockReturnValue(true);

    const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });

    vi.mocked(supabaseServer.createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-unauthorized", email: "intruder@example.com" } },
          error: null,
        }),
      },
      from: fromMock,
    } as unknown as Awaited<ReturnType<typeof supabaseServer.createServerSupabaseClient>>);

    const result = await requireOwner();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("fails closed with FORBIDDEN if database check errors out", async () => {
    vi.mocked(supabaseServer.isSupabaseConfigured).mockReturnValue(true);

    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Database connection timeout" },
    });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });

    vi.mocked(supabaseServer.createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123", email: "user@example.com" } },
          error: null,
        }),
      },
      from: fromMock,
    } as unknown as Awaited<ReturnType<typeof supabaseServer.createServerSupabaseClient>>);

    const result = await requireOwner();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("returns ok with owner details when user is allowlisted", async () => {
    vi.mocked(supabaseServer.isSupabaseConfigured).mockReturnValue(true);

    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: { owner_id: "user-123" },
      error: null,
    });
    const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
    const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });

    vi.mocked(supabaseServer.createServerSupabaseClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123", email: "owner@planly.internal" } },
          error: null,
        }),
      },
      from: fromMock,
    } as unknown as Awaited<ReturnType<typeof supabaseServer.createServerSupabaseClient>>);

    const result = await requireOwner();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.ownerId).toBe("user-123");
      expect(result.data.email).toBe("owner@planly.internal");
    }
  });
});
