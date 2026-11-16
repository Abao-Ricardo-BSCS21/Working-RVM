import { NextRequest } from "next/server";
import { RoleName } from "@prisma/client";
import { apiResponse, rateLimit } from "@/lib/api-utils";
import { requireAuth } from "@/lib/permissions";
import {
  eventsSince,
  getArmedSession,
  getEthernetLink,
} from "@/lib/hardware/ethernet-bridge";

export const dynamic = "force-dynamic";

/** Polled by the recycle page and machine monitor. The Arduino does not call this. */
export async function GET(request: NextRequest) {
  const limited = rateLimit(request);
  if (limited) return limited;

  const { error } = await requireAuth([
    RoleName.STUDENT,
    RoleName.STAFF,
    RoleName.ADMINISTRATOR,
  ]);
  if (error) return error;

  const since = Number(new URL(request.url).searchParams.get("since") ?? "0");
  const session = getArmedSession();

  return apiResponse({
    link: getEthernetLink(),
    session: session
      ? {
          studentId: session.studentId,
          studentDbId: session.studentDbId,
          firstName: session.firstName,
          expiresAt: new Date(session.expiresAt).toISOString(),
        }
      : null,
    events: eventsSince(Number.isFinite(since) ? since : 0),
  });
}
