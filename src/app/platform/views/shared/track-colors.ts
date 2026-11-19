/**
 * Colours for people in both viewports. One source of truth: the plan (Canvas 2D) uses `hex`
 * as a fillStyle; the 3D view uses `rgb` (0 to 1 channels, display space) with
 * `Color.setRGB(r, g, b, LinearSRGBColorSpace)` or vertex colours.
 */
export type TrackColorRole = 'person' | 'keepClear' | 'selected';

export interface TrackColor {
  hex: string;
  rgb: { r: number; g: number; b: number };
}

function trackColor(hex: string): TrackColor {
  const digits = hex.replace('#', '');
  return {
    hex,
    rgb: {
      r: parseInt(digits.slice(0, 2), 16) / 255,
      g: parseInt(digits.slice(2, 4), 16) / 255,
      b: parseInt(digits.slice(4, 6), 16) / 255,
    },
  };
}

export const TRACK_COLORS: Readonly<Record<TrackColorRole, TrackColor>> = {
  /** Matches --pc-person in tokens.css. */
  person: trackColor('#3FD9BA'),
  /** Matches --watch: standing in a keep-clear lane. */
  keepClear: trackColor('#F08A2B'),
  /** Matches --gold: the one selected person. */
  selected: trackColor('#C9A84C'),
};

/** Selection wins over keep-clear, which wins over the normal colour. */
export function trackColorRole(trackId: string, keepClearIds: ReadonlySet<string>, selectedId: string | null): TrackColorRole {
  if (trackId === selectedId) {
    return 'selected';
  }
  if (keepClearIds.has(trackId)) {
    return 'keepClear';
  }
  return 'person';
}
