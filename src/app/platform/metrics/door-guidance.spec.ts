import type { ShuttleStatus } from '../data/track.model';
import {
  INITIAL_STABLE_DOOR_ADVICE,
  currentDoorAdvice,
  nextStableDoorAdvice,
  type DoorAdvice,
  type StableDoorAdviceState,
} from './door-guidance';
import type { PlatformMetrics } from './platform-metrics';

const DOORS_CLOSED: ShuttleStatus = { phase: 'approaching', arrivesInSeconds: 60, doorsOpen: false, spaceFor: 120 };
const DOORS_OPEN: ShuttleStatus = { phase: 'docked', arrivesInSeconds: 0, doorsOpen: true, spaceFor: 120 };

function metricsWithDoorCounts(counts: number[]): PlatformMetrics {
  const totalCount = counts.reduce((sum, count) => sum + count, 0);
  const evenShare = totalCount / counts.length;
  const roomAtQuietDoors = counts.filter((count) => count < evenShare).reduce((sum, count) => sum + evenShare - count, 0);
  return {
    totalCount,
    capacity: 120,
    percentFull: Math.round((totalCount / 120) * 100),
    waitingByDoor: counts.map((count, index) => ({
      doorId: index + 1,
      label: `Door ${index + 1}`,
      count,
      aboveEvenShare: count > evenShare,
    })),
    evenShare,
    roomAtQuietDoors: Math.round(roomAtQuietDoors),
    keepClearTrackIds: new Set(),
  };
}

describe('currentDoorAdvice', () => {
  it('names the quiet doors and the room left when the platform is crowded', () => {
    const advice = currentDoorAdvice(metricsWithDoorCounts([46, 41, 24, 13]), DOORS_CLOSED);

    expect(advice).toEqual({ quietDoorIds: [3, 4], roomForPeople: 25 });
  });

  it('gives no advice below 90% full', () => {
    // 107 people is 89%
    expect(currentDoorAdvice(metricsWithDoorCounts([40, 37, 20, 10]), DOORS_CLOSED)).toBeNull();
    // 108 people is 90%
    expect(currentDoorAdvice(metricsWithDoorCounts([40, 38, 20, 10]), DOORS_CLOSED)).not.toBeNull();
  });

  it('gives no advice while the shuttle doors are open', () => {
    expect(currentDoorAdvice(metricsWithDoorCounts([46, 41, 24, 13]), DOORS_OPEN)).toBeNull();
  });

  it('gives no advice when the doors are evenly used', () => {
    expect(currentDoorAdvice(metricsWithDoorCounts([30, 30, 30, 30]), DOORS_CLOSED)).toBeNull();
  });
});

describe('nextStableDoorAdvice', () => {
  const doorsThreeAndFour = (room: number): DoorAdvice => ({ quietDoorIds: [3, 4], roomForPeople: room });
  const doorFour = (room: number): DoorAdvice => ({ quietDoorIds: [4], roomForPeople: room });

  function play(
    events: Array<[seconds: number, advice: DoorAdvice | null, breachShown?: boolean]>,
    from = INITIAL_STABLE_DOOR_ADVICE,
  ): StableDoorAdviceState {
    return events.reduce(
      (state, [seconds, advice, breachShown = false]) =>
        nextStableDoorAdvice(state, { t: seconds * 1000, advice, breachShown }),
      from,
    );
  }

  it('shows advice only after the same doors have held for 3 seconds', () => {
    expect(play([[0, doorsThreeAndFour(20)], [2.9, doorsThreeAndFour(21)]]).shown).toBeNull();

    const shown = play([[0, doorsThreeAndFour(20)], [2.9, doorsThreeAndFour(21)], [3, doorsThreeAndFour(22)]]).shown;
    expect(shown).toEqual(doorsThreeAndFour(22));
  });

  it('ignores a door set that flickers for less than 3 seconds', () => {
    const state = play([
      [0, doorsThreeAndFour(20)],
      [3, doorsThreeAndFour(20)],
      [4, doorFour(12)],
      [5, doorsThreeAndFour(20)],
      [6, doorFour(12)],
      [8, doorsThreeAndFour(20)],
    ]);

    expect(state.shown?.quietDoorIds).toEqual([3, 4]);
  });

  it('switches doors once the new set has held for 3 seconds', () => {
    const state = play([[0, doorsThreeAndFour(20)], [3, doorsThreeAndFour(20)], [4, doorFour(12)], [7, doorFour(13)]]);

    expect(state.shown).toEqual(doorFour(13));
  });

  it('updates the number at most every 5 seconds', () => {
    const shownAtThree = play([[0, doorsThreeAndFour(20)], [3, doorsThreeAndFour(20)]]);

    expect(play([[4, doorsThreeAndFour(24)], [7.9, doorsThreeAndFour(26)]], shownAtThree).shown?.roomForPeople).toBe(20);
    expect(play([[4, doorsThreeAndFour(24)], [8, doorsThreeAndFour(26)]], shownAtThree).shown?.roomForPeople).toBe(26);
  });

  it('hides the advice once it has been absent for 3 seconds', () => {
    const shown = play([[0, doorsThreeAndFour(20)], [3, doorsThreeAndFour(20)]]);

    expect(play([[4, null], [6.9, null]], shown).shown).not.toBeNull();
    expect(play([[4, null], [7, null]], shown).shown).toBeNull();
  });

  it('stays open while the breach card is on screen, then closes 3 seconds after the breach ends', () => {
    const shown = play([[0, doorsThreeAndFour(20)], [3, doorsThreeAndFour(20)]]);

    const duringBreach = play([[4, null, true], [10, null, true], [20, null, true]], shown);
    expect(duringBreach.shown).toEqual(doorsThreeAndFour(20));

    const afterBreach = play([[21, null, false], [24, null, false]], duringBreach);
    expect(afterBreach.shown).toBeNull();
  });

  it('does not open while the breach card is on screen', () => {
    const state = play([[0, doorsThreeAndFour(20), true], [5, doorsThreeAndFour(20), true]]);

    expect(state.shown).toBeNull();
  });

  it('may still switch doors while the breach card is on screen', () => {
    const shown = play([[0, doorsThreeAndFour(20)], [3, doorsThreeAndFour(20)]]);

    const switched = play([[4, doorFour(12), true], [7, doorFour(12), true]], shown);
    expect(switched.shown).toEqual(doorFour(12));
  });

  it('restarts the wait if the clock goes backwards', () => {
    const state = play([[100, doorsThreeAndFour(20)], [2, doorsThreeAndFour(20)], [4.9, doorsThreeAndFour(20)]]);

    expect(state.shown).toBeNull();
  });
});
