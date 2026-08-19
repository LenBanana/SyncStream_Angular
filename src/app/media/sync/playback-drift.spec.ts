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
    cooldownRemainingMs: 0,
    roomPlaying: true,
    localPaused: false
  };

  it('does nothing while the drift is within the noise floor', () => {
    const action = decideDriftAction({ ...base, currentSeconds: 100.02 });
    expect(action.kind).toBe('hold');
  });

  it('trims a drift too small to seek for but large enough to see', () => {
    // The deadband only has to cover measurement noise, because what it gates is a rate nudge rather than a
    // jump. Sizing it as though corrections were expensive let two viewers settle at opposite edges of it and
    // stay there, differing by twice its width with neither being touched.
    const action = decideDriftAction({ ...base, currentSeconds: 99.9 });

    expect(action.kind).toBe('nudge');
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

  it('scales the rate change to how far out of step the player is', () => {
    // Proportional, not on-off. A gain high enough to saturate immediately corrects a barely-noticeable error
    // as hard as a large one, which is both audible and prone to overshooting back out of the hold zone.
    const small = decideDriftAction({ ...base, currentSeconds: 99.8 });
    const large = decideDriftAction({ ...base, currentSeconds: 99.2 });

    if (small.kind !== 'nudge' || large.kind !== 'nudge') {
      fail('expected both to nudge');
      return;
    }
    expect(small.playbackRate - 1).toBeLessThan(large.playbackRate - 1);
    expect(small.playbackRate - 1).toBeLessThan(DriftLimits.maxRateAdjust);
  });

  it('uses the full rate change once the gap is large enough to warrant it', () => {
    const action = decideDriftAction({ ...base, currentSeconds: 100 - DriftLimits.nudgeSeconds + 0.01 });

    if (action.kind !== 'nudge') {
      fail('expected a nudge just inside the threshold');
      return;
    }
    expect(action.playbackRate - 1).toBeCloseTo(DriftLimits.maxRateAdjust, 9);
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

  it('seeks when the target is not buffered, rather than trying to play its way there', () => {
    // No amount of rate adjustment crosses a hole in the buffer.
    const action = decideDriftAction({ ...base, currentSeconds: 100.2, targetBuffered: false });
    expect(action.kind).toBe('seek');
  });

  it('leaves an in-step player alone even when the target reads as unbuffered', () => {
    // At the live edge of a stream the buffer routinely ends a few frames short of where the room is. Seeking
    // there to correct a gap smaller than the tolerance causes the stall the seek was supposed to prevent.
    const action = decideDriftAction({ ...base, currentSeconds: 100.02, targetBuffered: false });
    expect(action.kind).toBe('hold');
  });

  describe('when the room is paused', () => {
    const paused = { ...base, roomPlaying: false };

    it('seeks instead of nudging, because a rate change cannot move a fixed target', () => {
      // The rate only closes a gap while both ends are running. Nudging a paused room left the drift at the
      // moment of pausing exactly where it was, and it reappeared the instant playback resumed. Reports stop
      // arriving while paused, so there is no later correction to rely on either.
      const action = decideDriftAction({ ...paused, currentSeconds: 99.6 });

      expect(action.kind).toBe('seek');
      if (action.kind === 'seek') {
        expect(action.toSeconds).toBe(100);
      }
    });

    it('still leaves a player alone that is already on the right frame', () => {
      const action = decideDriftAction({ ...paused, currentSeconds: 100.02 });
      expect(action.kind).toBe('hold');
    });
  });

  it('does not chase the room while this player is paused', () => {
    // The target advances a second every second and a paused player cannot follow it, so correcting would
    // seek again on every report for as long as the viewer stays paused. Their position is corrected on the
    // resume, which is the first moment it can be held.
    const action = decideDriftAction({ ...base, currentSeconds: 90, localPaused: true });
    expect(action.kind).toBe('hold');
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
