/**
 * Backup Export Route — GET /api/backup/export
 *
 * PLANLY_BUILD_SPEC.md §5, §16, §17 (AC24), R16:
 * Authenticated streaming download of versioned user data.
 * Does not enter shared public caches.
 */

import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/require-owner";
import { exportUserData } from "@/features/backup/service";

export async function GET() {
  const auth = await requireOwner();
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, message: auth.message },
      { status: auth.code === "UNAUTHENTICATED" ? 401 : auth.code === "FORBIDDEN" ? 403 : 503 }
    );
  }
  const ownerId = auth.data.ownerId;

  const backup = exportUserData(ownerId);
  const jsonContent = JSON.stringify(backup, null, 2);
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `planly-backup-${ownerId.slice(0, 8)}-${timestamp}.json`;

  return new NextResponse(jsonContent, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, no-cache, private, must-revalidate",
    },
  });
}
