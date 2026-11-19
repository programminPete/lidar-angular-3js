import { TRACK_COLORS } from '../shared/track-colors';
import { perceivedLuminance, pointIntensityForRole } from './point-cloud-colors';

describe('pointIntensityForRole', () => {
  it('draws keep-clear people as bright as normal ones', () => {
    const teal = perceivedLuminance(TRACK_COLORS.person.rgb) * pointIntensityForRole('person');
    const orange = perceivedLuminance(TRACK_COLORS.keepClear.rgb) * pointIntensityForRole('keepClear');
    expect(orange).toBeCloseTo(teal);
  });

  it('draws the selected person brighter than everyone else', () => {
    const teal = perceivedLuminance(TRACK_COLORS.person.rgb) * pointIntensityForRole('person');
    const gold = perceivedLuminance(TRACK_COLORS.selected.rgb) * pointIntensityForRole('selected');
    expect(gold).toBeGreaterThan(teal);
  });
});
