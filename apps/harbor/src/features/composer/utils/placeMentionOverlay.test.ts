import { Spacing } from '@/src/common/theme';
import { placeMentionOverlay } from './placeMentionOverlay';

const win = { width: 1000, height: 800 };

describe('placeMentionOverlay', () => {
  it('opens below an @ in the upper half, filling the remaining height', () => {
    expect(placeMentionOverlay({ x: 100, top: 90, bottom: 110 }, win)).toEqual({
      left: 100,
      width: 320,
      top: 110 + Spacing.sm,
      maxHeight: 800 - 110 - 12,
    });
  });

  it('opens above an @ in the lower half', () => {
    expect(placeMentionOverlay({ x: 100, top: 690, bottom: 710 }, win)).toEqual(
      {
        left: 100,
        width: 320,
        bottom: 800 - 690 + Spacing.sm,
        maxHeight: 690 - 12,
      },
    );
  });

  it('clamps to the window edge and shrinks on narrow screens', () => {
    expect(placeMentionOverlay({ x: 900, top: 0, bottom: 20 }, win).left).toBe(
      1000 - 320 - 12,
    );
    expect(
      placeMentionOverlay(
        { x: 0, top: 0, bottom: 20 },
        { width: 300, height: 800 },
      ).width,
    ).toBe(300 - 24);
  });
});
