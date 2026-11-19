import { TRACK_COLORS, trackColorRole } from './track-colors';

describe('TRACK_COLORS', () => {
  it('uses the agreed hex values', () => {
    expect(TRACK_COLORS.person.hex).toBe('#3FD9BA');
    expect(TRACK_COLORS.keepClear.hex).toBe('#F08A2B');
    expect(TRACK_COLORS.selected.hex).toBe('#C9A84C');
  });

  it('gives the same colour as 0 to 1 channels', () => {
    expect(TRACK_COLORS.keepClear.rgb).toEqual({ r: 0xf0 / 255, g: 0x8a / 255, b: 0x2b / 255 });
  });
});

describe('trackColorRole', () => {
  const keepClear = new Set(['T-2']);

  it('prefers selected, then keep-clear, then person', () => {
    expect(trackColorRole('T-2', keepClear, 'T-2')).toBe('selected');
    expect(trackColorRole('T-2', keepClear, null)).toBe('keepClear');
    expect(trackColorRole('T-3', keepClear, 'T-2')).toBe('person');
  });
});
