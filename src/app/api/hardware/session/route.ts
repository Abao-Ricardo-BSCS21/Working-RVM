import { NextRequest } from "next/server";
import { RoleName } from "@prisma/client";
import { apiError, apiResponse, parseBody, rateLimit } from "@/lib/api-utils";
import { requireAuth } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { disarmMachineSession } from "@/lib/hardware/ethernet-bridge";

export const dynamic = "force-dynamic";

/** Ends the barcode session that lets the W5500 award points. */
export async function POST(request: NextRequest) {
  const limited = rateLimit(request);
  if (limited) return limited;

  const { error, session } = await requireAuth([
    RoleName.STUDENT,
    RoleName.STAFF,
    RoleName.ADMINISTRATOR,
  ]);
  if (error) return error;

  const body = await parseBody<{ studentDbId?: number }>(request);
  let studentDbId = body?.studentDbId;

  if (session!.user.role === RoleName.STUDENT) {
    const me = await prisma.student.findFirst({
      where: { userId: Number(session!.user.id) },
      select: { id: true },
    });
    if (!me) return apiError("Student profile not found", 404);
    if (studentDbId && studentDbId !== me.id) {
      return apiError("You can only end your own machine session", 403);
    }
    studentDbId = me.id;
  }

  disarmMachineSession(studentDbId);
  return apiResponse({ active: false });
}
