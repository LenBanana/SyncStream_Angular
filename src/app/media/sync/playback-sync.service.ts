import { Injectable } from '@angular/core';
import { SignalRService } from '../../services/signal-r.service';
import { DriftLimits, decideDriftAction, targetPosition } from './playback-drift';
import { PlaybackTarget } from './playback-target';
import { TimeSync } from './time-sync';

/**
 * Keeps a viewer's player in step with the room.
 *
 * One implementation for every player, replacing the eight-line correction block that was copy-pasted into
 * three of them. It owns the two pieces of state a correction needs and neither player had: an estimate of
 * one-way latency, and how recently a seek happened.
 */
@Injectable({ providedIn: 'root' })
export class PlaybackSyncService {
  /** Recent round trips, in seconds. */
  private roundTrips: number[] = [];

  /** When the current post-seek quiet period ends. */
  private cooldownUntilMs = 0;

  /**
   * Seeks issued without the player getting back into step in between.
   *
   * Each one lengthens the quiet period. A player that keeps needing to be jumped is not drifting, it is
   * failing to keep up, and correcting it at a fixed rate forever is worse for the viewer than letting it sit
   * a little behind.
   */
  private consecutiveSeeks = 0;

  /** Consecutive settled reports, counted towards forgetting a run of corrections. */
  private steadyReports = 0;

  /** The position last seen, so a player that is not advancing can be told from one that is. */
  private lastSeen: { position: number; atMs: number } | null = null;

  private readonly maxSamples = 8;

  /** Set while the tab is hidden, so the next correction is not held back by the quiet period. */
  private returnedFromBackground = false;

  constructor(signalR: SignalRService) {
    // A hidden tab has its timers throttled and its media suspended, so on return the quiet period from
    // whatever happened before it was hidden is stale and should not delay the first correction. Noticing here
    // rather than in each player keeps it in one place.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.returnedFromBackground = true;
        }
      });
    }

    // The stream is a BehaviorSubject that starts on a placeholder rather than a measurement, and a
    // placeholder taken for a sample sets the latency estimate for as long as it stays the smallest value
    // seen. Only replies to an actual ping carry a round trip.
    signalR.pingStream.subscribe(rtt => {
      if (typeof rtt !== 'number' || !isFinite(rtt) || rtt <= 0) {
        return;
      }
      this.roundTrips.push(rtt);
      if (this.roundTrips.length > this.maxSamples) {
        this.roundTrips.shift();
      }
    });
  }

  /**
   * One-way latency, taken as half the smallest recent round trip.
   *
   * The minimum rather than the latest or the mean, because the smallest sample is the one that queued least
   * and so is closest to the real transit time. The old code used the newest sample and added the whole round
   * trip as though it were one-way, overshooting every correction by about half an RTT.
   */
  get oneWayLatencySeconds(): number {
    if (this.roundTrips.length === 0) {
      return 0;
    }
    return Math.min(...this.roundTrips) / 2;
  }

  /**
   * Forgets the post-seek quiet period and any backoff.
   *
   * A new source is a new timeline, so a cooldown left over from correcting the previous one must not suppress
   * the first correction on this one, and a run of corrections on the old one says nothing about this one.
   */
  reset(): void {
    this.cooldownUntilMs = 0;
    this.consecutiveSeeks = 0;
    this.steadyReports = 0;
    this.lastSeen = null;
  }

  /**
   * Brings a player into step with a dated report from the room.
   *
   * @param nowMs Injectable clock, so the cooldown is testable.
   */
  apply(target: PlaybackTarget, sync: TimeSync, nowMs: number = Date.now()): void {
    const current = target.currentTime();
    if (current === null) {
      return;
    }

    const wanted = this.wantedPosition(target, sync);

    // A tab that has just come back was not playing while it was hidden, so a quiet period from before it was
    // hidden is protecting against a cascade that ended long ago, and the run of corrections that set the
    // backoff says nothing about the state now.
    //
    // Nothing else overrides the quiet period. A large gap is tempting to treat as a host scrub and correct at
    // once, but a player that stalled and recovered produces exactly the same large gap, and seeking straight
    // away is what makes it stall again. There is no way to tell the two apart from the position alone, and
    // getting it wrong rebuilds the cascade this whole path exists to prevent. A scrub is instead honoured as
    // soon as the period lapses, which is immediately in the ordinary case where nothing has been corrected
    // recently.
    if (this.returnedFromBackground) {
      this.returnedFromBackground = false;
      this.cooldownUntilMs = 0;
      this.consecutiveSeeks = 0;
    }

    const cooldownRemainingMs = Math.max(0, this.cooldownUntilMs - nowMs);

    // Stalled counts as busy: there is nothing useful to do to a player that is waiting on the network, and a
    // seek would send it back to waiting. The player's own readiness cannot answer this for an iframe.
    const stalled = this.hasStalled(target, sync, current, nowMs);
    this.lastSeen = { position: current, atMs: nowMs };
    const busy = target.busy() || stalled;

    const action = decideDriftAction({
      targetSeconds: wanted,
      currentSeconds: current,
      canNudgeRate: target.canNudgeRate(),
      targetBuffered: target.buffered(wanted),
      busy,
      cooldownRemainingMs,
      roomPlaying: sync.isPlaying,
      localPaused: target.paused()
    });

    // Only a decision that actually looked at the position counts as evidence the player is keeping up. A hold
    // returned because the period had not lapsed, or because the player was mid-seek, is not.
    //
    // And it takes several in a row. One was enough before, which meant a connection that buffers every few
    // seconds cleared the run on every recovery and never earned a longer wait, so it was corrected again a
    // couple of seconds later, forever.
    if (action.kind === 'seek') {
      this.steadyReports = 0;
    } else if (cooldownRemainingMs === 0 && !busy) {
      this.steadyReports++;
      if (this.steadyReports >= DriftLimits.steadyReportsToClearBackoff) {
        this.consecutiveSeeks = 0;
      }
    }

    switch (action.kind) {
      case 'hold':
        this.applyRate(target, 1);
        return;

      case 'nudge':
        this.applyRate(target, action.playbackRate);
        return;

      case 'seek':
        // Back to normal speed first: seeking while running fast would carry the adjustment across the jump.
        this.applyRate(target, 1);
        target.seekTo(action.toSeconds);
        this.cooldownUntilMs = nowMs + this.quietPeriodMs();
        this.consecutiveSeeks++;
        return;
    }
  }

  /**
   * Where this player should be, kept inside the video.
   *
   * Extrapolating from a dated report can land past the last frame near the end of a video, and seeking past
   * the end raises 'ended', which advances the playlist for that one viewer while everyone else is still
   * watching. Clamped just short of the end so the video finishes where the host says it does.
   */
  private wantedPosition(target: PlaybackTarget, sync: TimeSync): number {
    const wanted = targetPosition(sync.mediaTime, sync.ageMs, sync.isPlaying, this.oneWayLatencySeconds);
    const duration = target.duration();
    if (duration === null) {
      return Math.max(0, wanted);
    }
    return Math.min(Math.max(0, wanted), Math.max(0, duration - 0.25));
  }

  /**
   * Whether the player is not getting anywhere.
   *
   * Judged from the position it reports rather than from any readiness it exposes, so it works the same for a
   * media element and for an iframe that offers neither a buffered range nor a ready state. A player that is
   * meant to be running and has not moved is waiting on the network.
   */
  private hasStalled(
    target: PlaybackTarget, sync: TimeSync, current: number, nowMs: number): boolean {
    if (this.lastSeen === null) {
      return false;
    }

    // Both ends have to be running for standing still to mean anything.
    if (!sync.isPlaying || target.paused()) {
      return false;
    }

    // Too soon to tell: at a short interval a normally playing player has barely moved either.
    const elapsedSeconds = (nowMs - this.lastSeen.atMs) / 1000;
    if (elapsedSeconds < 0.5) {
      return false;
    }

    // A seek moves the position by more than playback would, so a correction is not read as a stall.
    const advanced = current - this.lastSeen.position;
    return advanced >= 0 && advanced < DriftLimits.stalledAdvanceSeconds;
  }

  /** The quiet period to apply to the seek about to be issued, doubled once per correction in the run. */
  private quietPeriodMs(): number {
    const doublings = Math.min(this.consecutiveSeeks, DriftLimits.maxCooldownDoublings);
    return DriftLimits.seekCooldownMs * Math.pow(2, doublings);
  }

  private applyRate(target: PlaybackTarget, rate: number): void {
    // Compared against the player's own rate, not a remembered one: the players are recreated when the source
    // or player type changes while this service lives for the session, so remembering it here meant a rate
    // from a previous instance could suppress the write that a new one needed.
    if (Math.abs(target.currentRate() - rate) < 0.001) {
      return;
    }
    target.setRate(rate);
  }
}
