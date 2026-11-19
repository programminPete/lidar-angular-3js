import { formatTimeOnPlatform } from './time-on-platform';

describe('formatTimeOnPlatform', () => {
  it('shows minutes and seconds from one minute up', () => {
    expect(formatTimeOnPlatform(190_400)).toBe('3 min 10 s');
    expect(formatTimeOnPlatform(60_000)).toBe('1 min 0 s');
  });

  it('shows whole seconds under a minute, rounding down', () => {
    expect(formatTimeOnPlatform(42_900)).toBe('42 s');
  });

  it('never shows a negative time', () => {
    expect(formatTimeOnPlatform(-500)).toBe('0 s');
  });
});
