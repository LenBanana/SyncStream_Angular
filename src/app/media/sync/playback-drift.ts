/**
 * How far out of step a viewer may drift, and what to do about it.
 *
 * These are the only numbers in the sync path. They were previously derived from the ping on every sample,
 * which made the tolerance flap with jitter: on a mobile link it oscillated, and each time it shrank it
 * triggered corrections that would not have fired a moment earlier.
 */
export const DriftLimits = {
  /**
   * Below this, do nothing.
   *
   * Sized to cover measurement noise and nothing more, because the correction it gates is a rate nudge, which
   * costs nothing: no re-buffer, no jump, and inaudible at a small delta. An earlier value of 0.15 was chosen as
   * though every correction were expensive, which is only true of seeking. The cost of a wide deadband is that
   * two viewers can settle at opposite edges of it and stay there, differing by twice its width with neither
   * one being corrected, which is exactly what a room notices when two players are compared side by side.
   *
   * At 50ms this is under a typical frame time, so converging inside it is as close as the players can be told
   * apart anyway.
   */
  holdSeconds: 0.05,

  /** Up to this, correct by nudging the playback rate. Beyond it, seek. */
  nudgeSeconds: 1.0,

  /**
   * Tolerance for players that cannot take a fine-grained rate.
   *
   * YouTube and Vimeo are iframe providers whose setPlaybackRate only accepts coarse steps, so for them the
   * choice is "leave it" or "seek", and seeking too eagerly is what makes mobile playback stutter. A wider band
   * means fewer seeks at the cost of looser sync.
   *
   * Set to what the previous threshold-based code effectively used, rather than the wider 0.75 tried first. The
   * quiet period below now lengthens on a run of corrections, so a player that cannot afford to seek backs
   * itself off instead of needing a permanently loose band to protect it.
   */
  coarseHoldSeconds: 0.5,

  /** Largest rate change, as a fraction. 8% is inaudible once browsers correct pitch. */
  maxRateAdjust: 0.08,

  /**
   * How aggressively drift converts into a rate change.
   *
   * Chosen with maxRateAdjust so the rate saturates at 0.4s of drift: below that the correction is
   * proportional and a small error gets a small, inaudible nudge, above it the full 8% is used to close the
   * gap. A much higher gain saturates almost immediately, which corrects a 0.2s error as hard as a 0.9s one
   * and turns the band into on-off control with an audible sawtooth.
   */
  rateGain: 0.2,

  /**
   * Quiet period after a seek.
   *
   * A seek on a phone means a re-buffer, which means a stall, which means falling further behind. Without a
   * pause afterwards the next report sees the new gap and seeks again, and the loop sustains itself. This is
   * the single most important number here for mobile.
   */
  seekCooldownMs: 2000,

  /**
   * How many times the quiet period doubles while corrections keep being needed.
   *
   * A player that cannot keep up stalls, falls behind, gets seeked, stalls again. The quiet period caps that
   * at one seek per period, but on a connection that is simply too slow it would go on capped at that rate for
   * as long as the video lasts. Doubling backs off to an occasional resync instead, which is what someone on a
   * bad link actually wants: a little behind and watchable, rather than jumping every couple of seconds.
   *
   * Four doublings takes the period from 2s to 32s.
   */
  maxCooldownDoublings: 4,

  /**
   * How many settled reports it takes to forget a run of corrections.
   *
   * One was not enough. A connection that buffers every few seconds recovers, looks in step for a single
   * report, and drifts out again, so the run was cleared on every cycle and the wait never grew past the
   * shortest one. The result is a correction every couple of seconds indefinitely, which is what a viewer sees
   * as the player pausing, loading and running over and over.
   */
  steadyReportsToClearBackoff: 4,

  /**
   * How little a position may advance between reports before the player counts as stalled.
   *
   * A player waiting on the network reports the same position each time. Correcting one is worse than leaving
   * it, because a seek starts the buffering again, and the readyState check that catches this for a media
   * element sees nothing for an iframe: a YouTube frame has no media element to ask, so buffering there was
   * invisible and every stall was answered with a seek.
   */
  stalledAdvanceSeconds: 0.1
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

  /**
   * Whether the room is playing.
   *
   * A rate change only moves a player that is running, so when the room is paused the target is a fixed
   * point and the rate has nothing to converge on: the only correction that does anything is a seek. Nudging
   * a paused room meant the drift at the moment of pausing stayed exactly as it was, and reappeared the
   * instant playback resumed.
   */
  roomPlaying: boolean;

  /**
   * Whether this player is paused.
   *
   * When the room is playing and this player is not, no correction helps: the target advances a second every
   * second and the player cannot follow it. Chasing it would seek repeatedly for as long as the viewer stays
   * paused. The position is corrected once they resume, which is the first moment it can be held.
   */
  localPaused: boolean;
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

  const tolerance = input.canNudgeRate ? DriftLimits.holdSeconds : DriftLimits.coarseHoldSeconds;

  // Checked before anything else, including the buffer. A position a few frames away is as good as correct,
  // and seeking to it because the buffer happens not to cover it yet, which is ordinary at the live edge of a
  // stream, causes exactly the stall the seek was meant to avoid.
  if (distance < tolerance) {
    return { kind: 'hold' };
  }

  // No amount of rate adjustment crosses a gap in the buffer.
  if (!input.targetBuffered) {
    return { kind: 'seek', toSeconds: input.targetSeconds };
  }

  // A rate change needs both ends running: a paused player does not move, and a paused room does not either.
  if (!input.roomPlaying) {
    return { kind: 'seek', toSeconds: input.targetSeconds };
  }

  if (input.localPaused) {
    return { kind: 'hold' };
  }

  if (!input.canNudgeRate || distance >= DriftLimits.nudgeSeconds) {
    return { kind: 'seek', toSeconds: input.targetSeconds };
  }

  const adjust = clamp(drift * DriftLimits.rateGain, -DriftLimits.maxRateAdjust, DriftLimits.maxRateAdjust);
  return { kind: 'nudge', playbackRate: 1 + adjust };
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
