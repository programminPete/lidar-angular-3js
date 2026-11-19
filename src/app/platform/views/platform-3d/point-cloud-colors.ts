import { Color, LinearSRGBColorSpace } from 'three';
import { TRACK_COLORS, type TrackColorRole } from '../shared/track-colors';

/**
 * Colours for the 3D view. People colours come from the shared TRACK_COLORS; the structure and
 * line colours below are copied from `src/styles/tokens.css`.
 *
 * The renderer outputs without sRGB conversion, so these values are added together in display
 * space, the same way the Canvas 2D design mock (`design-lab/kit/pc.js`) adds them.
 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A THREE.Color holding the value as-is (no sRGB to linear conversion). */
export function displayColor(value: number | Rgb): Color {
  if (typeof value === 'number') {
    return new Color().setHex(value, LinearSRGBColorSpace);
  }
  return new Color().setRGB(value.r, value.g, value.b, LinearSRGBColorSpace);
}

export const VIEWPORT_BACKGROUND = 0x07080a;
/** --pc-structure-lo and --pc-structure-hi, as 0 to 1 channels. */
export const STRUCTURE_LOW: Rgb = { r: 0x3d / 255, g: 0x4a / 255, b: 0x57 / 255 };
export const STRUCTURE_HIGH: Rgb = { r: 0x8f / 255, g: 0xa6 / 255, b: 0xb5 / 255 };

/** --text-1, for the platform outline and the berth ghost. */
export const OUTLINE_COLOR = 0xe8eaed;
/** --ok, for the keep-clear lanes. */
export const LANE_COLOR = 0x35c4a5;
export const SELECTION_COLOR = TRACK_COLORS.selected.rgb;

/** Rec. 709 luma: how bright a colour looks, 0 to 1. */
export function perceivedLuminance(color: Rgb): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/** Point brightness for a normal (teal) person, before crowd dimming and fades. */
const PERSON_POINT_INTENSITY = 0.46;
/** The selected person is drawn a little brighter than everyone else. */
const SELECTED_BOOST = 1.25;

/**
 * Point brightness per colour role, scaled so every role looks about as bright as teal:
 * orange and gold have lower luminance, so their points are drawn stronger.
 */
export function pointIntensityForRole(role: TrackColorRole): number {
  const teal = perceivedLuminance(TRACK_COLORS.person.rgb);
  const ownLuminance = perceivedLuminance(TRACK_COLORS[role].rgb);
  const boost = role === 'selected' ? SELECTED_BOOST : 1;
  return PERSON_POINT_INTENSITY * (teal / ownLuminance) * boost;
}
