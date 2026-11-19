import type { ShuttleStatus } from '../data/track.model';
import { CROWDED_PERCENT, quietDoorIds, type PlatformMetrics } from './platform-metrics';

/** A suggestion to staff: these doors have room for about this many more people. */
export interface DoorAdvice {
  quietDoorIds: number[];
  roomForPeople: number;
}

/** A change of quiet doors (or showing / hiding the advice) must hold this long before it shows. */
export const DOOR_SET_STABLE_MS = 3000;
/** The shown number of people updates at most this often. */
export const ROOM_UPDATE_INTERVAL_MS = 5000;

/**
 * Advice for this frame, or null when there is none worth giving: the platform is under
 * CROWDED_PERCENT full, the shuttle doors are open (people are boarding), or no door is
 * over its even share.
 */
export function currentDoorAdvice(metrics: PlatformMetrics, shuttle: ShuttleStatus | null): DoorAdvice | null {
  const isCrowded = metrics.percentFull >= CROWDED_PERCENT;
  const doorsOpen = shuttle?.doorsOpen ?? false;
  const anyDoorOverEvenShare = metrics.waitingByDoor.some((door) => door.aboveEvenShare);
  const quietDoors = quietDoorIds(metrics);
  if (!isCrowded || doorsOpen || !anyDoorOverEvenShare || quietDoors.length === 0 || metrics.roomAtQuietDoors === 0) {
    return null;
  }
  return { quietDoorIds: quietDoors, roomForPeople: metrics.roomAtQuietDoors };
}

/** Holds the advice on screen steady while the live value wobbles frame to frame. */
export interface StableDoorAdviceState {
  shown: DoorAdvice | null;
  /** Door set (see `doorSetKey`) waiting to replace the shown one, and since when (epoch ms). */
  pendingKey: string | null;
  pendingSince: number | null;
  /** Epoch ms when the shown number last changed. */
  roomUpdatedAt: number | null;
}

export const INITIAL_STABLE_DOOR_ADVICE: StableDoorAdviceState = {
  shown: null,
  pendingKey: null,
  pendingSince: null,
  roomUpdatedAt: null,
};

/**
 * Reducer: fold this frame's advice (from `currentDoorAdvice`) into what is shown; use with RxJS `scan`.
 * `breachShown` is true while the breach card is on screen (active or clearing).
 */
export function nextStableDoorAdvice(
  state: StableDoorAdviceState,
  event: { t: number; advice: DoorAdvice | null; breachShown: boolean },
): StableDoorAdviceState {
  const { t, advice, breachShown } = event;

  // The breach card sits below this line, so the line must not open or close while the card is
  // on screen; that would move the card and its button. It may still change doors or numbers.
  const wouldOpenOrClose = (advice === null) !== (state.shown === null);
  if (breachShown && wouldOpenOrClose) {
    return { ...state, pendingKey: null, pendingSince: null };
  }

  const isSameDoorSet = doorSetKey(advice) === doorSetKey(state.shown);

  if (isSameDoorSet) {
    return { ...keepDoorSetUpdatingRoom(state, advice, t), pendingKey: null, pendingSince: null };
  }

  const candidateKey = doorSetKey(advice);
  const isNewCandidate = candidateKey !== state.pendingKey || state.pendingSince === null;
  // A restarted track server restarts the demo clock, so `t` can be earlier than pendingSince.
  const clockWentBack = state.pendingSince !== null && t < state.pendingSince;
  if (isNewCandidate || clockWentBack) {
    return { ...state, pendingKey: candidateKey, pendingSince: t };
  }

  const hasHeldLongEnough = t - (state.pendingSince ?? t) >= DOOR_SET_STABLE_MS;
  if (!hasHeldLongEnough) {
    return state;
  }
  return { shown: advice, pendingKey: null, pendingSince: null, roomUpdatedAt: t };
}

function keepDoorSetUpdatingRoom(
  state: StableDoorAdviceState,
  advice: DoorAdvice | null,
  t: number,
): StableDoorAdviceState {
  if (advice === null || state.shown === null || state.roomUpdatedAt === null) {
    return state;
  }
  const sinceRoomUpdate = t - state.roomUpdatedAt;
  const isDue = sinceRoomUpdate >= ROOM_UPDATE_INTERVAL_MS || sinceRoomUpdate < 0;
  const hasChanged = advice.roomForPeople !== state.shown.roomForPeople;
  if (!isDue || !hasChanged) {
    return state;
  }
  return { ...state, shown: advice, roomUpdatedAt: t };
}

/** "none" when there is no advice, otherwise the door ids, e.g. "3,4". */
function doorSetKey(advice: DoorAdvice | null): string {
  return advice === null ? 'none' : advice.quietDoorIds.join(',');
}
