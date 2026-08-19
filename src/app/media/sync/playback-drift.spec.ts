import { DriftLimits, decideDriftAction, targetPosition } from './playback-drift';

/**
 * The correction decision.
 *
 * This is the logic the mobile stutter came from. The previous version had one tool, a hard seek whenever
 * drift crossed a threshold, and on a phone a seek means a re-buffer, which means a stall, which means more
 * drift, which means another seek. The mechanism meant to hold sync was the thing breaking it.
 */
describe('decideDriftAction', () => {
  const base = {
    targetSeconds: 100,
    currentSeconds: 100,
    canNudgeRate: true,
    targetBuffered: true,
    busy: false,
    cooldownRemainingMs: 0
  };

  it('does nothing while the drift is within the noise floor', () => {
    const action = decideDriftAction({ ...base, currentSeconds: 100.1 });
    expect(action.kind).toBe('hold');
  });

  it('speeds up slightly when a little behind', () => {
    const action = decideDriftAction({ ...base, currentSeconds: 99.5 });

    expect(action.kind).toBe('nudge');
    if (action.kind === 'nudge') {
      expect(action.playbackRate).toBeGreaterThan(1);
      expect(action.playbackRate).toBeLessThanOrEqual(1 + DriftLimits.maxRateAdjust);
    }
  });

  it('slows down slightly when a little ahead', () => {
    const action = decideDriftAction({ ...base, currentSeconds: 100.5 });

    expect(action.kind).toBe('nudge');
    if (action.kind === 'nudge') {
      expect(action.playbackRate).toBeLessThan(1);
      expect(action.playbackRate).toBeGreaterThanOrEqual(1 - DriftLimits.maxRateAdjust);
    }
  });

  it('never asks for a rate change large enough to hear', () => {
    const action = decideDriftAction({ ...base, currentSeconds: 100 - DriftLimits.nudgeSeconds + 0.01 });

    if (action.kind === 'nudge') {
      // Epsilon because the clamp lands on the bound exactly and 1 + 0.08 is not representable, so the
      // difference reads as 0.08000000000000007. That is the bound, not a violation of it.
      expect(Math.abs(action.playbackRate - 1)).toBeLessThanOrEqual(DriftLimits.maxRateAdjust + 1e-9);
    } else {
      fail('expected a nudge just inside the threshold');
    }
  });

  it('seeks once the gap is too large to close by playing faster', () => {
    const action = decideDriftAction({ ...base, currentSeconds: 90 });

    expect(action.kind).toBe('seek');
    if (action.kind === 'seek') {
      expect(action.toSeconds).toBe(100);
    }
  });

  it('seeks when the target is not buffered, however small the gap', () => {
    // No amount of rate adjustment crosses a hole in the buffer.
    const action = decideDriftAction({ ...base, currentSeconds: 100.2, targetBuffered: false });
    expect(action.kind).toBe('seek');
  });

  it('holds during the quiet period after a seek', () => {
    // The cooldown is what stops one seek turning into a cascade on a slow connection.
    const action = decideDriftAction({ ...base, currentSeconds: 80, cooldownRemainingMs: 500 });
    expect(action.kind).toBe('hold');
  });

  it('holds while the player is seeking or not ready', () => {
    const action = decideDriftAction({ ...base, currentSeconds: 80, busy: true });
    expect(action.kind).toBe('hold');
  });

  describe('players that cannot take a fine-grained rate', () => {
    const coarse = { ...base, canNudgeRate: false };

    it('tolerates more drift before acting', () => {
      // A YouTube or Vimeo iframe only accepts coarse steps such as 1.25, which is audible and useless for
      // erasing a fraction of a second, so the choice is leave it or seek.
      const action = decideDriftAction({ ...coarse, currentSeconds: 100 - DriftLimits.coarseHoldSeconds + 0.05 });
      expect(action.kind).toBe('hold');
    });

    it('seeks rather than nudging once past that tolerance', () => {
      const action = decideDriftAction({ ...coarse, currentSeconds: 100 - DriftLimits.coarseHoldSeconds - 0.05 });
      expect(action.kind).toBe('seek');
    });
  });
});

describe('targetPosition', () => {
  it('adds the report age and the one-way latency while playing', () => {
    // The server says where playback was and how long ago; the viewer adds its own transit time. Every term
    // comes from one clock, so no clock synchronisation is involved.
    expect(targetPosition(100, 250, true, 0.05)).toBeCloseTo(100.3, 5);
  });

  it('does not extrapolate a paused position', () => {
    // A paused position does not advance, and adding to it would put viewers past everyone else.
    expect(targetPosition(100, 5000, false, 0.05)).toBe(100);
  });

  it('treats a fresh report as needing only the latency', () => {
    expect(targetPosition(42, 0, true, 0.1)).toBeCloseTo(42.1, 5);
  });
});
