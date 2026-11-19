import { INITIAL_BREACH_STATE, isBreachShown, nextBreachState, type BreachEvent, type BreachState } from './breach-detector';

const CAPACITY = 120;
const START = Date.UTC(2026, 10, 17, 17, 42, 0);

function frame(secondsFromStart: number, count: number): BreachEvent {
  return { kind: 'frame', t: START + secondsFromStart * 1000, count, capacity: CAPACITY };
}

const ACKNOWLEDGE: BreachEvent = { kind: 'acknowledge' };

function run(events: BreachEvent[], from: BreachState = INITIAL_BREACH_STATE): BreachState {
  return events.reduce(nextBreachState, from);
}

describe('nextBreachState', () => {
  it('starts with one breach already logged today and none shown', () => {
    expect(INITIAL_BREACH_STATE.breachesToday).toBe(1);
    expect(INITIAL_BREACH_STATE.phase).toBe('none');
    expect(isBreachShown(INITIAL_BREACH_STATE)).toBe(false);
  });

  it('is pending, not shown, until the count has been over capacity for 5 seconds', () => {
    const pending = run([frame(0, 121), frame(4.9, 125)]);
    expect(pending.phase).toBe('pending');
    expect(isBreachShown(pending)).toBe(false);

    const active = nextBreachState(pending, frame(5, 125));
    expect(active.phase).toBe('active');
    expect(active.breachesToday).toBe(2);
  });

  it('measures duration from when the count first went over', () => {
    const state = run([frame(0, 121), frame(5, 124), frame(40, 124)]);

    expect(state.startedAt).toBe(START);
    expect(state.durationSeconds).toBe(40);
  });

  it('does not treat a count equal to capacity as over', () => {
    const state = run([frame(0, 120), frame(10, 120)]);

    expect(state.phase).toBe('none');
    expect(state.startedAt).toBeNull();
  });

  it('drops a pending breach as soon as the count dips back', () => {
    const state = run([frame(0, 125), frame(3, 120), frame(4, 125), frame(8, 125)]);

    expect(state.phase).toBe('pending');
    expect(state.startedAt).toBe(START + 4000);
  });

  describe('clearing', () => {
    const active = run([frame(0, 125), frame(5, 125), frame(30, 125)]);

    it('moves to clearing with the duration frozen when the count comes back', () => {
      const clearing = run([frame(41, 118), frame(43, 116)], active);

      expect(clearing.phase).toBe('clearing');
      expect(isBreachShown(clearing)).toBe(true);
      expect(clearing.durationSeconds).toBe(41);
      expect(clearing.clearingSince).toBe(START + 41_000);
    });

    it('ends after 3 seconds at or under capacity and keeps the day total', () => {
      const ended = run([frame(41, 118), frame(43.9, 118), frame(44, 118)], active);

      expect(ended.phase).toBe('none');
      expect(ended.startedAt).toBeNull();
      expect(ended.durationSeconds).toBe(0);
      expect(ended.breachesToday).toBe(2);
    });

    it('returns to active with the original start time if the count goes back over', () => {
      const backOver = run([frame(41, 118), frame(42, 122), frame(45, 123)], active);

      expect(backOver.phase).toBe('active');
      expect(backOver.startedAt).toBe(START);
      expect(backOver.durationSeconds).toBe(45);
      expect(backOver.clearingSince).toBeNull();
      expect(backOver.breachesToday).toBe(2);
    });
  });

  describe('when the count wobbles around capacity', () => {
    const wobble = [
      frame(0, 125),
      frame(5, 124),
      ACKNOWLEDGE,
      frame(10, 120),
      frame(11, 119),
      frame(12, 121),
      frame(13, 120),
      frame(15, 122),
      frame(20, 123),
    ];

    it('stays one active breach with the acknowledgement kept', () => {
      const state = run(wobble);

      expect(state.phase).toBe('active');
      expect(state.acknowledged).toBe(true);
      expect(state.breachesToday).toBe(2);
      expect(state.startedAt).toBe(START);
      expect(state.durationSeconds).toBe(20);
    });

    it('restarts the 3 second hold each time the count goes back over', () => {
      const state = run([...wobble, frame(21, 118), frame(23, 118), frame(23.5, 121), frame(25, 119), frame(27.9, 119)]);

      expect(state.phase).toBe('clearing');
      expect(state.clearingSince).toBe(START + 25_000);
    });
  });

  it('marks the breach acknowledged, including while clearing, and resets that for the next breach', () => {
    const acknowledged = run([frame(0, 125), frame(5, 125), frame(6, 118), ACKNOWLEDGE]);
    expect(acknowledged.phase).toBe('clearing');
    expect(acknowledged.acknowledged).toBe(true);

    const nextBreach = run([frame(9, 110), frame(100, 125), frame(105, 125)], acknowledged);
    expect(nextBreach.phase).toBe('active');
    expect(nextBreach.acknowledged).toBe(false);
    expect(nextBreach.breachesToday).toBe(3);
  });

  it('resets cleanly, keeping the day total, when the clock goes backwards', () => {
    const active = run([frame(0, 125), frame(5, 125), frame(40, 125)]);

    const afterRestart = nextBreachState(active, frame(2, 125));

    expect(afterRestart.phase).toBe('pending');
    expect(afterRestart.acknowledged).toBe(false);
    expect(afterRestart.startedAt).toBe(START + 2000);
    expect(afterRestart.breachesToday).toBe(2);
  });

  it('ignores an acknowledgement when no breach is shown', () => {
    const state = run([frame(0, 125), ACKNOWLEDGE]);

    expect(state.acknowledged).toBe(false);
  });
});
