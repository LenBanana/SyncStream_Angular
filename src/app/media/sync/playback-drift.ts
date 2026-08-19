/**
 * How far out of step a viewer may drift, and what to do about it.
 *
 * These are the only numbers in the sync path. They were previously derived from the ping on every sample,
 * which made the tolerance flap with jitter: on a mobile link it oscillated, and each time it shrank it
 * triggered corrections that would not have fired a moment earlier.
 */
export const DriftLimits = {
  /** Below this, do nothing. Roughly the noise floor of reading currentTime. */
  holdSeconds: 0.15,

  /** Up to this, correct by nudging the playback rate. Beyond it, seek. */
  nudgeSeconds: 1.0,

  /**
   * Tolerance for players that cannot take a fine-grained rate.
   *
   * YouTube and Vimeo are iframe providers whose setPlaybackRate only accepts coarse steps, so for them the
   * choice is "leave it" or "seek", and seeking too eagerly is what makes mobile playback stutter. A wider
   * band means fewer seeks at the cost of looser sync.
   */
  coarseHoldSeconds: 0.75,

  /** Largest rate change, as a fraction. 8% is inaudible once browsers correct pitch. */
  maxRateAdjust: 0.08,

  /** How aggressively drift converts into a rate change. */
  rateGain: 0.5,

  /**
   * Quiet period after a seek.
   *
   * A seek on a phone means a re-buffer, which means a stall, which means falling further behind. Without a
   * pause afterwards the next report sees the new gap and seeks again, and the loop sustains itself. This is
   * the single most important number here for mobile.
   */
  seekCooldownMs: 2000
} as const;

export type DriftAction =
  /** In step: hold the rate at 1. */
  | { kind: 'hold' }
  /** Close: converge by playing slightly faster or slower. */
  | { kind: 'nudge'; playbackRate: number }
  /** Too far, or the target is not buffered: jump. */
  | { kind: 'seek'; toSeconds: number };

export interface DriftInput {
  /** Where the room is, in seconds, already compensated for staleness and latency. */
  targetSeconds: number;

  /** Where this player is, in seconds. */
  currentSeconds: number;

  /** Whether the player can take an arbitrary playback rate. False for iframe providers. */
  canNudgeRate: boolean;

  /** Whether the target lies inside a buffered range. Pass true when it cannot be determined. */
  targetBuffered: boolean;

  /** Whether the player is mid-seek or not yet ready to report a reliable position. */
  busy: boolean;

  /** Milliseconds left of the post-seek quiet period. */
  cooldownRemainingMs: number;
}

/**
 * Decides how to bring one player back into step.
 *
 * The previous approach had exactly one tool, a hard seek whenever drift exceeded a threshold. On a phone a
 * seek causes a re-buffer, so the correction itself creates more drift, and the next report seeks again: the
 * mechanism meant to hold sync was the thing breaking it. Nudging the rate erases sub-second drift without
 * interrupting playback at all, and seeking is reserved for gaps too large to close that way.
 */
export function decideDriftAction(input: DriftInput): DriftAction {
  // Measuring mid-seek or before the player can report reliably yields garbage, and correcting during the
  // quiet period is what turns one seek into a cascade.
  if (input.busy || input.cooldownRemainingMs > 0) {
    return { kind: 'hold' };
  }

  const drift = input.targetSeconds - input.currentSeconds;
  const distance = Math.abs(drift);

  // No amount of rate adjustment crosses a gap in the buffer.
  if (!input.targetBuffered) {
    return { kind: 'seek', toSeconds: input.targetSeconds };
  }

  if (!input.canNudgeRate) {
    return distance < DriftLimits.coarseHoldSeconds
      ? { kind: 'hold' }
      : { kind: 'seek', toSeconds: input.targetSeconds };
  }

  if (distance < DriftLimits.holdSeconds) {
    return { kind: 'hold' };
  }

  if (distance < DriftLimits.nudgeSeconds) {
    const adjust = clamp(drift * DriftLimits.rateGain, -DriftLimits.maxRateAdjust, DriftLimits.maxRateAdjust);
    return { kind: 'nudge', playbackRate: 1 + adjust };
  }

  return { kind: 'seek', toSeconds: input.targetSeconds };
}

/**
 * Where the room actually is now, from a dated report.
 *
 * The server says where playback was and how long ago that was; the viewer adds its own one-way latency.
 * Every term comes from a single clock, so no clock synchronisation is involved. A paused position does not
 * advance, so nothing is added to it.
 */
export function targetPosition(
  mediaTimeSeconds: number,
  ageMs: number,
  isPlaying: boolean,
  oneWayLatencySeconds: number
): number {
  if (!isPlaying) {
    return mediaTimeSeconds;
  }
  return mediaTimeSeconds + ageMs / 1000 + oneWayLatencySeconds;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
