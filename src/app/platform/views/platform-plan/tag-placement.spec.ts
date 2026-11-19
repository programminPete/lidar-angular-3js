import { chooseTagSide, indexOfBoxAt, tagOffset } from './tag-placement';

const TAG = { width: 120, height: 22 };
const PANEL = { width: 800, height: 500 };
const DOT = { x: 400, y: 250 };
/** A door label just right of the dot, where a right-side tag would sit. */
const LABEL_ON_RIGHT = { x: 440, y: 244, width: 44, height: 14 };
/** A door label just left of the dot. */
const LABEL_ON_LEFT = { x: 316, y: 244, width: 44, height: 14 };

describe('chooseTagSide', () => {
  it('starts on the right, centred beside the dot', () => {
    expect(chooseTagSide(DOT, TAG, PANEL, [], null)).toBe('right');
    expect(tagOffset('right', TAG)).toEqual({ x: 14, y: -11 });
  });

  it('keeps its current side while that side is clear, even when the preferred side is free', () => {
    expect(chooseTagSide(DOT, TAG, PANEL, [], 'left')).toBe('left');
    expect(chooseTagSide(DOT, TAG, PANEL, [], 'below')).toBe('below');
  });

  it('changes side only when the current side is blocked by a door label', () => {
    expect(chooseTagSide(DOT, TAG, PANEL, [LABEL_ON_RIGHT], 'right')).toBe('left');
  });

  it('holds the new side after a change, rather than returning once the old side clears', () => {
    const afterChange = chooseTagSide(DOT, TAG, PANEL, [LABEL_ON_RIGHT], 'right');

    // The person walks on and the right side is free again: the tag stays where it went.
    expect(chooseTagSide(DOT, TAG, PANEL, [], afterChange)).toBe('left');
  });

  it('moves again straight away when the side it just moved to is blocked too', () => {
    const afterChange = chooseTagSide(DOT, TAG, PANEL, [LABEL_ON_RIGHT], 'right');

    expect(chooseTagSide(DOT, TAG, PANEL, [LABEL_ON_RIGHT, LABEL_ON_LEFT], afterChange)).toBe('below');
  });

  it('avoids the panel edges, and stays put when nowhere is usable', () => {
    expect(chooseTagSide({ x: 760, y: 250 }, TAG, PANEL, [], null)).toBe('left');
    const everywhere = { x: 0, y: 0, width: 800, height: 500 };
    expect(chooseTagSide(DOT, TAG, PANEL, [everywhere], 'above')).toBe('above');
  });
});

describe('indexOfBoxAt', () => {
  it('finds the label a point lies under, allowing a small gap', () => {
    const boxes = [LABEL_ON_LEFT, LABEL_ON_RIGHT];

    expect(indexOfBoxAt({ x: 450, y: 250 }, boxes, 4)).toBe(1);
    expect(indexOfBoxAt({ x: 438, y: 250 }, boxes, 4)).toBe(1);
    expect(indexOfBoxAt({ x: 400, y: 250 }, boxes, 4)).toBe(-1);
  });
});

describe('chooseTagSide along the path', () => {
  it('moves to the side that stays clear longest where the person is walking, not the first clear one', () => {
    // Right is blocked. Walking down the screen, a tag on the left would run into this label within a second.
    const labelDownAndLeft = { x: 270, y: 300, width: 30, height: 14 };
    const walkingDown = { x: 0, y: 40 };

    expect(chooseTagSide(DOT, TAG, PANEL, [LABEL_ON_RIGHT, labelDownAndLeft], 'right')).toBe('left');
    expect(chooseTagSide(DOT, TAG, PANEL, [LABEL_ON_RIGHT, labelDownAndLeft], 'right', walkingDown)).toBe('below');
  });

  it('keeps the side it moved to on the following frames while it stays clear', () => {
    const labelDownAndLeft = { x: 270, y: 300, width: 30, height: 14 };
    const walkingDown = { x: 0, y: 40 };
    const nextFrameDot = { x: 400, y: 251 };

    expect(chooseTagSide(nextFrameDot, TAG, PANEL, [LABEL_ON_RIGHT, labelDownAndLeft], 'below', walkingDown)).toBe('below');
  });
});
