import type { ShuttlePhase, ShuttleStatus, Track, TrackFrame } from '../track.model';
import { PLATFORM_LAYOUT, isInsideRect, type PlatformDoor, type Point } from '../platform-layout';
import { SeededRandom } from './seeded-random';

// Pure TypeScript with no Angular imports: the Node track server runs this same class.

/** The first frame the simulator emits reads 17:42:00 local time on this date. */
export const DEMO_CLOCK_START = new Date(2026, 10, 17, 17, 42, 0).getTime();

/** One full shuttle cycle. Cycle time 0 is the moment the shuttle docks. */
const CYCLE_SECONDS = 130;
const DOCKED_SECONDS = 25;
const DEPARTING_SECONDS = 5;
const SHUTTLE_SPACES = 120;

/**
 * Cycle time of the first emitted frame. Chosen so a visitor sees about 100 people at once
 * and the first capacity breach becomes active roughly 30 seconds after page load.
 */
const FIRST_FRAME_CYCLE_SECONDS = 72;
const PREWARM_STEP_SECONDS = 0.1;

/**
 * Planned crowd size over a cycle, as [cycle seconds, people waiting]. Arrivals steer toward it,
 * so every cycle climbs past capacity (120) about 35 seconds before the shuttle docks.
 */
const CROWD_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [DOCKED_SECONDS, 20],
  [30, 22],
  [60, 95],
  [95, 121],
  [CYCLE_SECONDS, 134],
];
const ARRIVALS_WHILE_DOCKED_PER_SECOND = 0.4;
const MAX_ARRIVALS_PER_SECOND = 3;

/** Share of arriving passengers who head for each door, Door 1 (nearest the escalators) first. */
const DOOR_PREFERENCE = [0.37, 0.33, 0.19, 0.11];
const KEEP_CLEAR_STANDER_SHARE = 0.04;

const PERSONAL_SPACE_METRES = 0.5;
const MIN_SPOT_SPACING_METRES = 0.6;
const MAX_SPEED_METRES_PER_SECOND = 1.8;
const IDLE_DRIFT_METRES = 0.12;
/** A door lets one person on board about this often. */
const DOOR_BOARDING_INTERVAL_SECONDS = 0.3;
/** Boarding people disappear once they are this close to their door. */
const DOOR_REACH_METRES = 0.7;
/** A boarding person slows to a shuffle when someone this close is between them and the door. */
const QUEUE_GAP_METRES = 0.65;
const QUEUE_SHUFFLE_SPEED = 0.15;
/** Boarders push apart harder than waiting people, so a queue stays about 0.45 m apart. */
const BOARDING_SEPARATION_STRENGTH = 1.5;
const WAITING_SEPARATION_STRENGTH = 0.8;
/** While docked, a queue this much longer than a neighbouring door's sends someone across, twice a second. */
const QUEUE_SPILL_DIFFERENCE = 3;
const QUEUE_SPILL_INTERVAL_MS = 500;

type PersonState = 'walking' | 'waiting' | 'boarding';

interface Person {
  id: string;
  position: Point;
  velocity: Point;
  heading: number;
  walkSpeed: number;
  doorIndex: number;
  /** Where this person stands while waiting for the shuttle. */
  spot: Point;
  state: PersonState;
  firstSeen: number;
  driftPhase: number;
}

export class PlatformSimulator {
  private readonly random: SeededRandom;
  private readonly cycleOriginMs = DEMO_CLOCK_START - FIRST_FRAME_CYCLE_SECONDS * 1000;
  private clockMs = this.cycleOriginMs;
  private people: Person[] = [];
  private nextIdNumber: number;
  private spacesLeft = SHUTTLE_SPACES;
  private doorReadyAtMs: number[] = PLATFORM_LAYOUT.doors.map(() => 0);
  private nextQueueSpillAtMs = 0;

  constructor(seed: number) {
    this.random = new SeededRandom(seed);
    this.nextIdNumber = this.random.integer(9000, 9400);
    const prewarmSteps = Math.round(FIRST_FRAME_CYCLE_SECONDS / PREWARM_STEP_SECONDS) - 1;
    for (let step = 0; step < prewarmSteps; step++) {
      this.advance(PREWARM_STEP_SECONDS);
    }
  }

  step(dtSeconds: number): TrackFrame {
    this.advance(dtSeconds);
    return {
      t: this.clockMs,
      tracks: this.people.map(toTrack),
      shuttle: this.shuttleStatus(),
    };
  }

  private advance(dtSeconds: number): void {
    const phaseBefore = this.phase();
    this.clockMs += Math.round(dtSeconds * 1000);
    const phaseNow = this.phase();

    if (phaseNow === 'docked' && phaseBefore !== 'docked') {
      this.startBoarding();
    }
    if (phaseNow !== 'docked' && phaseBefore === 'docked') {
      this.stopBoarding();
    }
    this.spawnArrivals(dtSeconds, phaseNow);
    this.movePeople(dtSeconds);
    if (phaseNow === 'docked') {
      this.spillToShorterQueues();
      this.boardAtOpenDoors();
    }
  }

  private cycleSeconds(): number {
    const sinceOrigin = (this.clockMs - this.cycleOriginMs) / 1000;
    return sinceOrigin % CYCLE_SECONDS;
  }

  private phase(): ShuttlePhase {
    const cycleSeconds = this.cycleSeconds();
    if (cycleSeconds < DOCKED_SECONDS) {
      return 'docked';
    }
    if (cycleSeconds < DOCKED_SECONDS + DEPARTING_SECONDS) {
      return 'departing';
    }
    return 'approaching';
  }

  private shuttleStatus(): ShuttleStatus {
    const phase = this.phase();
    const isApproaching = phase === 'approaching';
    return {
      phase,
      arrivesInSeconds: isApproaching ? Math.ceil(CYCLE_SECONDS - this.cycleSeconds()) : 0,
      doorsOpen: phase === 'docked',
      spaceFor: isApproaching ? SHUTTLE_SPACES : this.spacesLeft,
    };
  }

  // ---- Arrivals --------------------------------------------------------------------------

  /** People per second stepping off the escalators: enough to close the gap to the crowd profile. */
  private arrivalsPerSecond(phase: ShuttlePhase): number {
    if (phase === 'docked') {
      return ARRIVALS_WHILE_DOCKED_PER_SECOND;
    }
    const lookAheadSeconds = 2;
    const plannedCrowd = crowdProfileAt(this.cycleSeconds() + lookAheadSeconds);
    const shortfall = plannedCrowd - this.people.length;
    return Math.min(Math.max(shortfall * 0.5, 0), MAX_ARRIVALS_PER_SECOND);
  }

  private spawnArrivals(dtSeconds: number, phase: ShuttlePhase): void {
    const arrivalChance = this.arrivalsPerSecond(phase) * dtSeconds;
    if (this.random.next() < arrivalChance) {
      this.people.push(this.createArrival(phase));
    }
  }

  private createArrival(phase: ShuttlePhase): Person {
    const escalators = PLATFORM_LAYOUT.escalators;
    const escalator = escalators[this.random.integer(0, escalators.length - 1)];
    const stepOffPoint = {
      x: escalator.x + escalator.width + 0.3,
      y: escalator.y + escalator.height / 2 + this.random.between(-0.3, 0.3),
    };
    const doorIndex = this.random.weightedIndex(DOOR_PREFERENCE);
    const id = `T-${this.nextIdNumber}`;
    this.nextIdNumber += this.random.integer(1, 9);

    return {
      id,
      position: stepOffPoint,
      velocity: { x: 1, y: 0 },
      heading: 0,
      walkSpeed: this.random.between(1.0, 1.4),
      doorIndex,
      spot: this.chooseWaitingSpot(doorIndex),
      state: phase === 'docked' ? 'boarding' : 'walking',
      firstSeen: this.clockMs,
      driftPhase: this.random.between(0, Math.PI * 2),
    };
  }

  /** A free spot in a fan-shaped area in front of the door, clear of the keep-clear lanes. */
  private chooseWaitingSpot(doorIndex: number): Point {
    const door = PLATFORM_LAYOUT.doors[doorIndex];
    if (this.random.next() < KEEP_CLEAR_STANDER_SHARE) {
      return this.spotInsideKeepClear(door);
    }

    let fallback: Point = { x: door.center.x, y: PLATFORM_LAYOUT.doorWallY - 5 };
    for (let attempt = 0; attempt < 40; attempt++) {
      const angleFromDoor = this.random.between(-1.25, 1.25);
      const distanceFromDoor = 1.4 + 7.5 * Math.pow(this.random.next(), 1.5);
      const candidate = {
        x: door.center.x + Math.sin(angleFromDoor) * distanceFromDoor * 1.4,
        y: PLATFORM_LAYOUT.doorWallY - 0.4 - Math.cos(angleFromDoor) * distanceFromDoor,
      };
      if (!isOpenFloor(candidate)) {
        continue;
      }
      fallback = candidate;
      if (!this.isNearAnotherSpot(candidate)) {
        return candidate;
      }
    }
    return fallback;
  }

  private spotInsideKeepClear(door: PlatformDoor): Point {
    const lane = door.keepClear;
    return {
      x: this.random.between(lane.x + 0.3, lane.x + lane.width - 0.3),
      y: this.random.between(lane.y + 0.4, lane.y + lane.height - 0.4),
    };
  }

  private isNearAnotherSpot(candidate: Point): boolean {
    return this.people.some(
      (person) => person.state !== 'boarding' && distance(person.spot, candidate) < MIN_SPOT_SPACING_METRES,
    );
  }

  // ---- Boarding --------------------------------------------------------------------------

  private startBoarding(): void {
    this.spacesLeft = SHUTTLE_SPACES;
    for (const person of this.people) {
      person.state = 'boarding';
    }
  }

  /** Anyone still on the platform when the doors close goes back to waiting near their door. */
  private stopBoarding(): void {
    for (const person of this.people) {
      if (person.state === 'boarding') {
        person.state = 'walking';
        person.spot = this.chooseWaitingSpot(person.doorIndex);
      }
    }
  }

  /** People at a crowded door move to a neighbouring door whose queue is much shorter. */
  private spillToShorterQueues(): void {
    if (this.clockMs < this.nextQueueSpillAtMs) {
      return;
    }
    this.nextQueueSpillAtMs = this.clockMs + QUEUE_SPILL_INTERVAL_MS;

    const doors = PLATFORM_LAYOUT.doors;
    const queueLengths = doors.map((_, doorIndex) => this.boardersAt(doorIndex).length);
    doors.forEach((_, doorIndex) => {
      for (const neighbourIndex of [doorIndex - 1, doorIndex + 1]) {
        const isRealDoor = neighbourIndex >= 0 && neighbourIndex < doors.length;
        if (!isRealDoor || queueLengths[doorIndex] - queueLengths[neighbourIndex] < QUEUE_SPILL_DIFFERENCE) {
          continue;
        }
        const neighbourX = doors[neighbourIndex].center.x;
        const closestToNeighbour = this.boardersAt(doorIndex).reduce((best, person) =>
          Math.abs(person.position.x - neighbourX) < Math.abs(best.position.x - neighbourX) ? person : best,
        );
        closestToNeighbour.doorIndex = neighbourIndex;
        queueLengths[doorIndex] -= 1;
        queueLengths[neighbourIndex] += 1;
      }
    });
  }

  private boardersAt(doorIndex: number): Person[] {
    return this.people.filter((person) => person.state === 'boarding' && person.doorIndex === doorIndex);
  }

  private boardAtOpenDoors(): void {
    PLATFORM_LAYOUT.doors.forEach((door, doorIndex) => {
      if (this.spacesLeft <= 0 || this.clockMs < this.doorReadyAtMs[doorIndex]) {
        return;
      }
      const boarder = this.people.find(
        (person) =>
          person.state === 'boarding' &&
          person.doorIndex === doorIndex &&
          distance(person.position, door.center) < DOOR_REACH_METRES,
      );
      if (!boarder) {
        return;
      }
      this.people = this.people.filter((person) => person !== boarder);
      this.spacesLeft -= 1;
      const intervalMs = DOOR_BOARDING_INTERVAL_SECONDS * 1000 * this.random.between(0.7, 1.3);
      this.doorReadyAtMs[doorIndex] = this.clockMs + intervalMs;
    });

    if (this.spacesLeft <= 0) {
      this.stopBoarding();
    }
  }

  // ---- Movement --------------------------------------------------------------------------

  private movePeople(dtSeconds: number): void {
    const steeringBlend = Math.min(1, dtSeconds * 4);
    for (const person of this.people) {
      const desired = this.desiredVelocity(person);
      const avoidance = this.avoidanceVelocity(person);
      const target = { x: desired.x + avoidance.x, y: desired.y + avoidance.y };
      person.velocity = clampLength(
        {
          x: person.velocity.x + (target.x - person.velocity.x) * steeringBlend,
          y: person.velocity.y + (target.y - person.velocity.y) * steeringBlend,
        },
        MAX_SPEED_METRES_PER_SECOND,
      );
    }

    for (const person of this.people) {
      person.position = keepOnPlatform({
        x: person.position.x + person.velocity.x * dtSeconds,
        y: person.position.y + person.velocity.y * dtSeconds,
      });
      if (length(person.velocity) > 0.05) {
        person.heading = Math.atan2(person.velocity.y, person.velocity.x);
      }
      if (person.state === 'walking' && distance(person.position, person.spot) < 0.2) {
        person.state = 'waiting';
      }
    }
  }

  /** Walk toward the spot or the door, slowing on arrival; waiting people sway around their spot. */
  private desiredVelocity(person: Person): Point {
    let goal: Point;
    let cruiseSpeed: number;
    if (person.state === 'boarding') {
      goal = PLATFORM_LAYOUT.doors[person.doorIndex].center;
      cruiseSpeed = this.isQueuedBehindSomeone(person, goal) ? QUEUE_SHUFFLE_SPEED : person.walkSpeed * 0.8;
    } else if (person.state === 'walking') {
      goal = person.spot;
      cruiseSpeed = person.walkSpeed;
    } else {
      const swayAngle = this.clockMs / 4000 + person.driftPhase;
      goal = {
        x: person.spot.x + Math.cos(swayAngle) * IDLE_DRIFT_METRES,
        y: person.spot.y + Math.sin(swayAngle * 0.7) * IDLE_DRIFT_METRES,
      };
      cruiseSpeed = 0.15;
    }

    const toGoal = { x: goal.x - person.position.x, y: goal.y - person.position.y };
    const distanceToGoal = length(toGoal);
    if (distanceToGoal < 1e-6) {
      return { x: 0, y: 0 };
    }
    const speed = Math.min(cruiseSpeed, distanceToGoal * 1.5);
    return { x: (toGoal.x / distanceToGoal) * speed, y: (toGoal.y / distanceToGoal) * speed };
  }

  /** True when another person stands close by, roughly between this person and the goal. */
  private isQueuedBehindSomeone(person: Person, goal: Point): boolean {
    const toGoal = { x: goal.x - person.position.x, y: goal.y - person.position.y };
    const distanceToGoal = length(toGoal);
    if (distanceToGoal < DOOR_REACH_METRES) {
      return false;
    }
    return this.people.some((other) => {
      if (other === person) {
        return false;
      }
      const toOther = { x: other.position.x - person.position.x, y: other.position.y - person.position.y };
      const gap = length(toOther);
      const alongGoal = (toOther.x * toGoal.x + toOther.y * toGoal.y) / distanceToGoal;
      const isAhead = alongGoal > gap * 0.6;
      return gap < QUEUE_GAP_METRES && isAhead;
    });
  }

  /** Push away from people closer than personal space, and from columns. */
  private avoidanceVelocity(person: Person): Point {
    const push = { x: 0, y: 0 };
    const separationStrength =
      person.state === 'boarding' ? BOARDING_SEPARATION_STRENGTH : WAITING_SEPARATION_STRENGTH;
    for (const other of this.people) {
      if (other === person) {
        continue;
      }
      addPushAway(push, person.position, other.position, PERSONAL_SPACE_METRES, separationStrength);
    }
    for (const column of PLATFORM_LAYOUT.columns) {
      addPushAway(push, person.position, column.center, column.radius + 0.35, 1.2);
    }
    return push;
  }
}

// ---- Geometry helpers ----------------------------------------------------------------------

function toTrack(person: Person): Track {
  return {
    id: person.id,
    x: roundTo(person.position.x, 2),
    y: roundTo(person.position.y, 2),
    heading: roundTo(person.heading, 3),
    speed: roundTo(length(person.velocity), 2),
    firstSeen: person.firstSeen,
  };
}

function crowdProfileAt(cycleSeconds: number): number {
  const clamped = Math.min(cycleSeconds, CYCLE_SECONDS);
  for (let index = 1; index < CROWD_PROFILE.length; index++) {
    const [endSeconds, endCrowd] = CROWD_PROFILE[index];
    if (clamped <= endSeconds) {
      const [startSeconds, startCrowd] = CROWD_PROFILE[index - 1];
      const progress = Math.max(0, (clamped - startSeconds) / (endSeconds - startSeconds));
      return startCrowd + (endCrowd - startCrowd) * progress;
    }
  }
  return CROWD_PROFILE[CROWD_PROFILE.length - 1][1];
}

function isOpenFloor(point: Point): boolean {
  const outline = PLATFORM_LAYOUT.outline;
  const insideOutline =
    point.x > outline.x + 0.4 &&
    point.x < outline.x + outline.width - 0.4 &&
    point.y > outline.y + 0.4 &&
    point.y < outline.y + outline.height - 0.4;
  const besideEscalators = point.x < 9.2 && point.y < 8.5;
  const inKeepClear = PLATFORM_LAYOUT.doors.some((door) => isInsideRect(point, door.keepClear, 0.25));
  const onBench = PLATFORM_LAYOUT.benches.some((bench) => isInsideRect(point, bench, 0.3));
  const atColumn = PLATFORM_LAYOUT.columns.some(
    (column) => distance(point, column.center) < column.radius + 0.5,
  );
  return insideOutline && !besideEscalators && !inKeepClear && !onBench && !atColumn;
}

function keepOnPlatform(point: Point): Point {
  const outline = PLATFORM_LAYOUT.outline;
  const margin = 0.2;
  return {
    x: Math.min(Math.max(point.x, outline.x + margin), outline.x + outline.width - margin),
    y: Math.min(Math.max(point.y, outline.y + margin), outline.y + outline.height - margin),
  };
}

function addPushAway(push: Point, from: Point, obstacle: Point, radius: number, strength: number): void {
  const dx = from.x - obstacle.x;
  const dy = from.y - obstacle.y;
  const gap = Math.hypot(dx, dy);
  if (gap >= radius || gap < 1e-6) {
    return;
  }
  const closeness = (radius - gap) / radius;
  push.x += (dx / gap) * closeness * strength;
  push.y += (dy / gap) * closeness * strength;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function length(vector: Point): number {
  return Math.hypot(vector.x, vector.y);
}

function clampLength(vector: Point, maxLength: number): Point {
  const vectorLength = length(vector);
  if (vectorLength <= maxLength) {
    return vector;
  }
  return { x: (vector.x / vectorLength) * maxLength, y: (vector.y / vectorLength) * maxLength };
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
