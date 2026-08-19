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

  private readonly maxSamples = 8;

  /** Set while the tab is hidden, so the next correction knows not to ease into it. */
  private returnedFromBackground = false;

  constructor(signalR: SignalRService) {
    // A hidden tab has its timers throttled and its media suspended, so drift on return is far larger than
    // anything the rate nudge can absorb. Noticing here rather than in each player keeps it in one place.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.returnedFromBackground = true;
        }
      });
    }

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
   * Forgets the post-seek quiet period.
   *
   * A new source is a new timeline, so a cooldown left over from correcting the previous one must not suppress
   * the first correction on this one.
   */
  reset(): void {
    this.cooldownUntilMs = 0;
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

    if (this.returnedFromBackground) {
      this.returnedFromBackground = false;
      this.forceResync(target, sync, nowMs);
      return;
    }

    const wanted = targetPosition(sync.mediaTime, sync.ageMs, sync.isPlaying, this.oneWayLatencySeconds);

    const action = decideDriftAction({
      targetSeconds: wanted,
      currentSeconds: current,
      canNudgeRate: target.canNudgeRate(),
      targetBuffered: target.buffered(wanted),
      busy: target.busy(),
      cooldownRemainingMs: Math.max(0, this.cooldownUntilMs - nowMs)
    });

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
        this.cooldownUntilMs = nowMs + DriftLimits.seekCooldownMs;
        return;
    }
  }

  /**
   * Corrects immediately, ignoring the quiet period.
   *
   * For coming back from a backgrounded tab, where the drift is far too large to converge by rate and there
   * is no point easing into it.
   */
  forceResync(target: PlaybackTarget, sync: TimeSync, nowMs: number = Date.now()): void {
    this.cooldownUntilMs = 0;
    const wanted = targetPosition(sync.mediaTime, sync.ageMs, sync.isPlaying, this.oneWayLatencySeconds);
    this.applyRate(target, 1);
    target.seekTo(wanted);
    this.cooldownUntilMs = nowMs + DriftLimits.seekCooldownMs;
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
