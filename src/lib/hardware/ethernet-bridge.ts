import { timingSafeEqual } from "crypto";
import { BARCODE_CONFIG } from "@/lib/constants/barcode";

export type HardwareItem = "BOTTLE" | "CAN" | "PING";

export type HardwareEvent = {
  id: number;
  item: HardwareItem;
  recordedAt: string;
  machineId: number | null;
  credited: boolean;
  duplicate: boolean;
  studentId: string | null;
  studentDbId: number | null;
  pointsEarned: number | null;
  totalPoints: number | null;
  totalBottles: number | null;
  message: string;
  achievementName: string | null;
};

export type ArmedSession = {
  studentDbId: number;
  studentId: string;
  firstName: string;
  lastName: string;
  machineId: number;
  expiresAt: number;
};

type BridgeState = {
  seq: number;
  events: HardwareEvent[];
  lastSeenAt: number;
  lastItem: HardwareItem | null;
  session: ArmedSession | null;
  lastAcceptAt: Partial<Record<HardwareItem, number>>;
};

const ONLINE_MS = 15_000;
const DUPLICATE_MS = 2_500;
const MAX_EVENTS = 40;

const globalState = globalThis as typeof globalThis & {
  __filcycleEthernet?: BridgeState;
};

function state(): BridgeState {
  if (!globalState.__filcycleEthernet) {
    globalState.__filcycleEthernet = {
      seq: 0,
      events: [],
      lastSeenAt: 0,
      lastItem: null,
      session: null,
      lastAcceptAt: {},
    };
  }
  return globalState.__filcycleEthernet;
}

export function hardwareKey(): string {
  return process.env.HARDWARE_KEY || "filcycle-dev";
}

export function isValidHardwareKey(provided: string | null): boolean {
  if (!provided) return false;
  const expected = Buffer.from(hardwareKey());
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function parseHardwareItem(raw: string | null): HardwareItem | null {
  if (!raw) return null;
  const item = raw.trim().toUpperCase();
  if (item === "BOTTLE" || item === "CAN" || item === "PING") return item;
  return null;
}

export function touchLink(item: HardwareItem | null) {
  const bridge = state();
  bridge.lastSeenAt = Date.now();
  if (item && item !== "PING") bridge.lastItem = item;
}

export function getEthernetLink() {
  const bridge = state();
  const ageMs = bridge.lastSeenAt ? Date.now() - bridge.lastSeenAt : null;
  return {
    online: ageMs !== null && ageMs < ONLINE_MS,
    lastSeenAt: bridge.lastSeenAt ? new Date(bridge.lastSeenAt).toISOString() : null,
    lastItem: bridge.lastItem,
    ageMs,
  };
}

export function getArmedSession(): ArmedSession | null {
  const bridge = state();
  if (!bridge.session) return null;
  if (Date.now() > bridge.session.expiresAt) {
    bridge.session = null;
    return null;
  }
  return bridge.session;
}

export function armMachineSession(session: Omit<ArmedSession, "expiresAt">) {
  const bridge = state();
  bridge.session = {
    ...session,
    expiresAt: Date.now() + BARCODE_CONFIG.SESSION_MINUTES * 60 * 1000,
  };
  return bridge.session;
}

export function disarmMachineSession(studentDbId?: number) {
  const bridge = state();
  if (!bridge.session) return false;
  if (studentDbId && bridge.session.studentDbId !== studentDbId) return false;
  bridge.session = null;
  return true;
}

/** Same item twice inside a couple of seconds is sensor bounce, not a second deposit. */
export function isDuplicateItem(item: HardwareItem): boolean {
  if (item === "PING") return false;
  const bridge = state();
  const previous = bridge.lastAcceptAt[item] ?? 0;
  const duplicate = Date.now() - previous < DUPLICATE_MS;
  bridge.lastAcceptAt[item] = Date.now();
  return duplicate;
}

export function pushHardwareEvent(
  event: Omit<HardwareEvent, "id" | "recordedAt">
): HardwareEvent {
  const bridge = state();
  const recorded: HardwareEvent = {
    ...event,
    id: ++bridge.seq,
    recordedAt: new Date().toISOString(),
  };
  bridge.events.push(recorded);
  if (bridge.events.length > MAX_EVENTS) {
    bridge.events.splice(0, bridge.events.length - MAX_EVENTS);
  }
  return recorded;
}

export function eventsSince(since: number): HardwareEvent[] {
  return state().events.filter((event) => event.id > since);
}
