import { FRAME_INTERVAL_MS, type Track, type TrackFrame } from '../../data/track.model';
import type { FramePair } from '../../state/platform-state.model';

/** How long a person takes to fade in when first seen, and to fade out after leaving. */
export const TRACK_FADE_MS = 250;

/** One person to draw this animation frame. Metres and radians in the platform frame. */
export interface DrawablePerson {
  readonly id: string;
  x: number;
  y: number;
  heading: number;
  /** Metres per second. */
  speed: number;
  /** 0 to 1. */
  opacity: number;
}

interface MotionEntry {
  /** Reused for this person's whole life, so drawing allocates nothing per animation frame. */
  person: DrawablePerson;
  /** performance.now() of the frame that first contained them; -Infinity if they were there from the start. */
  appearedAt: number;
  /** performance.now() of the first frame without them; null while present. */
  departedAt: number | null;
  /** Opacity when they left, so a person who leaves mid fade-in fades out from there. */
  opacityAtDeparture: number;
  /** Matches `frameNumber` when the person is in the latest frame. */
  seenInFrame: number;
}

/**
 * Smooth positions for render loops that draw at 60 fps from 10 Hz frames. Call `update(pair, now)`
 * once per animation frame, then read `people`.
 *
 * - Position, heading (the short way round) and speed blend from the previous frame to the
 *   current one over FRAME_INTERVAL_MS, so drawing runs one frame behind the stream.
 * - A person fades in over TRACK_FADE_MS when first seen. People in the very first pair start opaque.
 * - A person who leaves stays where they were last drawn and fades out over TRACK_FADE_MS.
 *
 * Reuse: `people` is the same array every frame, and each person keeps the same object while
 * they are on screen. Read them during the current animation frame; do not keep references.
 */
export class TrackMotion {
  private readonly entries = new Map<string, MotionEntry>();
  private readonly previousById = new Map<string, Track>();
  private readonly departing: MotionEntry[] = [];
  private readonly drawable: DrawablePerson[] = [];
  private latestFrame: TrackFrame | null = null;
  private frameNumber = 0;

  /** People to draw, in the latest frame's order, then those fading out. */
  get people(): readonly DrawablePerson[] {
    return this.drawable;
  }

  update(pair: FramePair | null, nowMs: number): void {
    if (pair === null) {
      this.drawable.length = 0;
      return;
    }
    if (pair.current !== this.latestFrame) {
      this.acceptNewFrame(pair);
    }

    const progress = clampToUnit((nowMs - pair.receivedAt) / FRAME_INTERVAL_MS);
    let count = 0;

    for (const track of pair.current.tracks) {
      const entry = this.entries.get(track.id);
      if (entry === undefined) {
        continue;
      }
      blendInto(entry.person, this.previousById.get(track.id), track, progress);
      entry.person.opacity = clampToUnit((nowMs - entry.appearedAt) / TRACK_FADE_MS);
      this.drawable[count++] = entry.person;
    }

    for (let index = this.departing.length - 1; index >= 0; index--) {
      const entry = this.departing[index];
      const fadeRemaining = 1 - (nowMs - (entry.departedAt ?? nowMs)) / TRACK_FADE_MS;
      if (fadeRemaining <= 0) {
        this.forget(entry, index);
        continue;
      }
      entry.person.opacity = entry.opacityAtDeparture * fadeRemaining;
      this.drawable[count++] = entry.person;
    }

    this.drawable.length = count;
  }

  /** Runs once per 10 Hz frame: index the previous frame, note arrivals and departures. */
  private acceptNewFrame(pair: FramePair): void {
    const isFirstPair = this.latestFrame === null;
    this.latestFrame = pair.current;
    this.frameNumber += 1;

    this.previousById.clear();
    for (const track of pair.previous.tracks) {
      this.previousById.set(track.id, track);
    }

    for (const track of pair.current.tracks) {
      const entry = this.entries.get(track.id) ?? this.addEntry(track, isFirstPair ? -Infinity : pair.receivedAt);
      if (entry.departedAt !== null) {
        this.returnFromDeparting(entry, pair.receivedAt);
      }
      entry.seenInFrame = this.frameNumber;
    }

    for (const entry of this.entries.values()) {
      const hasJustLeft = entry.seenInFrame !== this.frameNumber && entry.departedAt === null;
      if (hasJustLeft) {
        entry.departedAt = pair.receivedAt;
        entry.opacityAtDeparture = entry.person.opacity;
        this.departing.push(entry);
      }
    }
  }

  private addEntry(track: Track, appearedAt: number): MotionEntry {
    const entry: MotionEntry = {
      person: { id: track.id, x: track.x, y: track.y, heading: track.heading, speed: track.speed, opacity: 0 },
      appearedAt,
      departedAt: null,
      opacityAtDeparture: 0,
      seenInFrame: this.frameNumber,
    };
    this.entries.set(track.id, entry);
    return entry;
  }

  /** Someone seen again while fading out fades back in from their current opacity. */
  private returnFromDeparting(entry: MotionEntry, receivedAt: number): void {
    entry.appearedAt = receivedAt - entry.person.opacity * TRACK_FADE_MS;
    entry.departedAt = null;
    const index = this.departing.indexOf(entry);
    if (index >= 0) {
      this.departing.splice(index, 1);
    }
  }

  private forget(entry: MotionEntry, departingIndex: number): void {
    const last = this.departing.pop();
    if (last !== undefined && departingIndex < this.departing.length) {
      this.departing[departingIndex] = last;
    }
    this.entries.delete(entry.person.id);
  }
}

/** Writes the blend of `previous` and `current` into `person`. Without a previous position, draws `current`. */
function blendInto(person: DrawablePerson, previous: Track | undefined, current: Track, progress: number): void {
  const from = previous ?? current;
  person.x = from.x + (current.x - from.x) * progress;
  person.y = from.y + (current.y - from.y) * progress;
  person.heading = blendAngle(from.heading, current.heading, progress);
  person.speed = from.speed + (current.speed - from.speed) * progress;
}

/** Blends two angles (radians) along the shorter way round. */
export function blendAngle(from: number, to: number, progress: number): number {
  const fullTurn = Math.PI * 2;
  let difference = (to - from) % fullTurn;
  if (difference > Math.PI) {
    difference -= fullTurn;
  }
  if (difference < -Math.PI) {
    difference += fullTurn;
  }
  return from + difference * progress;
}

function clampToUnit(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
