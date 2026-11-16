import { NextRequest, NextResponse } from "next/server";
import { LogLevel } from "@prisma/client";
import prisma from "@/lib/prisma";
import {
  logMachineEvent,
  processBottleSubmission,
} from "@/lib/services/recycling-service";
import {
  getArmedSession,
  isDuplicateItem,
  isValidHardwareKey,
  parseHardwareItem,
  pushHardwareEvent,
  touchLink,
  type HardwareItem,
} from "@/lib/hardware/ethernet-bridge";

export const dynamic = "force-dynamic";

const ITEM_META: Record<
  Exclude<HardwareItem, "PING">,
  { material: string; label: string; weightGrams: number }
> = {
  BOTTLE: { material: "PET", label: "plastic bottle", weightGrams: 25 },
  CAN: { material: "ALUMINUM", label: "can", weightGrams: 15 },
};

function hardwareJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function resolveMachine(requested: string | null) {
  if (requested) {
    const machineId = Number(requested);
    if (Number.isSafeInteger(machineId) && machineId > 0) {
      const machine = await prisma.machine.findUnique({ where: { id: machineId } });
      if (machine) return machine;
    }
  }

  return prisma.machine.findFirst({
    where: { status: "ONLINE" },
    orderBy: { id: "asc" },
  });
}

async function ingest(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  let itemRaw = searchParams.get("item");
  let key = searchParams.get("key");
  let machineParam = searchParams.get("machine");

  if (!itemRaw && request.method === "POST") {
    try {
      const body = (await request.json()) as {
        item?: string;
        key?: string;
        machine?: string | number;
      };
      itemRaw = body.item ?? null;
      key = body.key ?? key;
      if (body.machine != null) machineParam = String(body.machine);
    } catch {
      // Arduino sends a query string. A missing body is fine.
    }
  }

  if (!isValidHardwareKey(key)) {
    return hardwareJson({ status: "error", message: "Unauthorized" }, 401);
  }

  if (itemRaw?.trim().toUpperCase() === "STATUS") {
    touchLink(null);
    return hardwareJson({
      status: "success",
      recorded: "STATUS",
      ready: getArmedSession() ? 1 : 0,
    });
  }

  const item = parseHardwareItem(itemRaw);
  if (!item) {
    return hardwareJson(
      { status: "error", message: "No item parameter" },
      itemRaw ? 400 : 400
    );
  }

  touchLink(item);

  if (item === "PING") {
    return hardwareJson({ status: "success", recorded: "PING" });
  }

  const machine = await resolveMachine(machineParam);
  if (!machine) {
    return hardwareJson({ status: "error", message: "No online machine" }, 503);
  }

  if (machine.status !== "ONLINE") {
    return hardwareJson({ status: "error", message: "Machine is offline" }, 503);
  }

  if (isDuplicateItem(item)) {
    pushHardwareEvent({
      item,
      machineId: machine.id,
      credited: false,
      duplicate: true,
      studentId: null,
      studentDbId: null,
      pointsEarned: null,
      totalPoints: null,
      totalBottles: null,
      message: `Ignored duplicate ${item} reading`,
      achievementName: null,
    });
    return hardwareJson({ status: "success", recorded: item, duplicate: true });
  }

  if (machine.bottlesStored >= machine.bottleCapacity) {
    await logMachineEvent(
      machine.id,
      `W5500 ${item} rejected: storage is full`,
      LogLevel.WARNING,
      { item, source: "w5500" }
    );
    pushHardwareEvent({
      item,
      machineId: machine.id,
      credited: false,
      duplicate: false,
      studentId: null,
      studentDbId: null,
      pointsEarned: null,
      totalPoints: null,
      totalBottles: null,
      message: "Machine storage is full",
      achievementName: null,
    });
    return hardwareJson({ status: "error", message: "Machine storage is full" }, 503);
  }

  const session = getArmedSession();
  const meta = ITEM_META[item];

  if (!session || (session.machineId && session.machineId !== machine.id)) {
    await logMachineEvent(
      machine.id,
      `W5500 detected ${item} with no active student session`,
      LogLevel.INFO,
      { item, source: "w5500" }
    );
    pushHardwareEvent({
      item,
      machineId: machine.id,
      credited: false,
      duplicate: false,
      studentId: null,
      studentDbId: null,
      pointsEarned: 0,
      totalPoints: null,
      totalBottles: null,
      message: `${item} detected. Scan a student barcode to award points.`,
      achievementName: null,
    });
    return hardwareJson({ status: "success", recorded: item, points: 0 });
  }

  const result = await processBottleSubmission(
    session.studentDbId,
    machine.id,
    meta.weightGrams,
    {
      material: meta.material,
      itemLabel: meta.label,
      source: "w5500",
      item,
    }
  );

  const updated = await prisma.student.findUnique({
    where: { id: session.studentDbId },
    select: { rewardPoints: true, bottlesRecycled: true, studentId: true },
  });

  const achievementName = result.achievements[0]?.name ?? null;

  await logMachineEvent(
    machine.id,
    `${item} accepted from ${session.firstName} ${session.lastName} (${session.studentId}) via W5500`,
    LogLevel.INFO,
    {
      item,
      source: "w5500",
      transactionId: result.transaction.id,
      studentId: session.studentId,
    }
  );

  pushHardwareEvent({
    item,
    machineId: machine.id,
    credited: true,
    duplicate: false,
    studentId: updated?.studentId ?? session.studentId,
    studentDbId: session.studentDbId,
    pointsEarned: result.transaction.pointsEarned,
    totalPoints: updated?.rewardPoints ?? null,
    totalBottles: updated?.bottlesRecycled ?? null,
    message: `${item} accepted`,
    achievementName,
  });

  return hardwareJson({
    status: "success",
    recorded: item,
    points: result.transaction.pointsEarned,
  });
}

export async function GET(request: NextRequest) {
  return ingest(request);
}

export async function POST(request: NextRequest) {
  return ingest(request);
}
