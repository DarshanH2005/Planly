export type MutationMeta = {
  requestId: string;
  expectedVersion: number;
};

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "AUTH_ERROR"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "STALE_PLAN"
  | "INVALID_STATE"
  | "DEADLINE_PASSED"
  | "SESSION_EXPIRED"
  | "CONTENT_UNAVAILABLE"
  | "PREREQUISITE_UNMET"
  | "CAPACITY_SHORTFALL"
  | "RESTORE_CONFLICT"
  | "SERVICE_UNAVAILABLE";

/** Result type for pure domain rules (no mutation metadata required). */
export type Result<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      code: ErrorCode;
      message: string;
      fieldErrors?: Record<string, string>;
      currentVersion?: number;
    };

/** Result type for mutation operations with version tracking. */
export type MutationResult<T> =
  | {
      ok: true;
      data: T;
      version: number;
      requestId: string;
    }
  | {
      ok: false;
      code: ErrorCode;
      message: string;
      fieldErrors?: Record<string, string>;
      currentVersion?: number;
    };

/** Success result for pure domain rules. */
export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** Success result for mutation operations with version/requestId tracking. */
export function okMutation<T>(data: T, version: number, requestId: string): MutationResult<T> {
  return { ok: true, data, version, requestId };
}

export function fail<T = never>(
  code: ErrorCode,
  message: string,
  opts?: { fieldErrors?: Record<string, string>; currentVersion?: number }
): Result<T> {
  return {
    ok: false,
    code,
    message,
    ...(opts?.fieldErrors ? { fieldErrors: opts.fieldErrors } : {}),
    ...(opts?.currentVersion !== undefined ? { currentVersion: opts.currentVersion } : {}),
  };
}
