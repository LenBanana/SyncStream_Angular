/**
 * The bit of a player the sync logic needs.
 *
 * There are three player implementations and the correction code used to be copy-pasted into each of them,
 * so a fix had to be made three times and the versions had already drifted. Everything specific to a player
 * lives behind this.
 */
export interface PlaybackTarget {
  /** Position in seconds, or null when it cannot be read yet. */
  currentTime(): number | null;

  seekTo(seconds: number): void;

  setRate(rate: number): void;

  /**
   * The rate the player is running at.
   *
   * Read back rather than remembered, so a rate the sync service applied to a previous player instance can
   * never be mistaken for the current one's.
   */
  currentRate(): number;

  /**
   * Whether this player accepts an arbitrary playback rate.
   *
   * False for iframe providers: YouTube and Vimeo only take coarse steps such as 1.25, which is audible and
   * useless for erasing a fraction of a second. Those fall back to a wider tolerance and a seek.
   */
  canNudgeRate(): boolean;

  /** Whether the player is mid-seek or not yet able to report a reliable position. */
  busy(): boolean;

  /** Whether a position is inside a buffered range. True when it cannot be determined. */
  buffered(seconds: number): boolean;

  /** Whether the player is paused. False when it cannot be determined. */
  paused(): boolean;

  /**
   * Length in seconds, or null when it is not known.
   *
   * Used to keep an extrapolated target inside the video. Near the end, adding the report's age and the
   * latency to the position can land past the last frame, and seeking there ends the video and advances the
   * playlist while the host still has a second to go.
   */
  duration(): number | null;
}

/** Wraps a Plyr instance, which backs the YouTube, Vimeo and direct-file players. */
export class PlyrTarget implements PlaybackTarget {
  constructor(private readonly player: any) {}

  currentTime(): number | null {
    const time = this.player?.currentTime;
    return typeof time === 'number' && isFinite(time) ? time : null;
  }

  seekTo(seconds: number): void {
    this.player.currentTime = seconds;
  }

  setRate(rate: number): void {
    // Plyr maps speed onto the underlying player, which for an iframe provider may quietly ignore it.
    this.player.speed = rate;
  }

  currentRate(): number {
    const speed = this.player?.speed;
    return typeof speed === 'number' && isFinite(speed) && speed > 0 ? speed : 1;
  }

  canNudgeRate(): boolean {
    return this.player?.provider === 'html5';
  }

  busy(): boolean {
    const media = this.player?.media;
    if (!media) {
      return false;
    }
    // readyState below HAVE_FUTURE_DATA means the reported position is not yet trustworthy.
    return media.seeking === true || (typeof media.readyState === 'number' && media.readyState < 3);
  }

  buffered(seconds: number): boolean {
    const media = this.player?.media;
    return isPositionBuffered(media?.buffered, seconds);
  }

  paused(): boolean {
    return this.player?.paused === true;
  }

  duration(): number | null {
    return finiteDuration(this.player?.duration);
  }
}

/** Wraps a video.js player, which backs the external and HLS sources. */
export class VideoJsTarget implements PlaybackTarget {
  constructor(private readonly player: any) {}

  currentTime(): number | null {
    const time = this.player?.currentTime?.();
    return typeof time === 'number' && isFinite(time) ? time : null;
  }

  seekTo(seconds: number): void {
    this.player.currentTime(seconds);
  }

  setRate(rate: number): void {
    this.player.playbackRate(rate);
  }

  currentRate(): number {
    const rate = this.player?.playbackRate?.();
    return typeof rate === 'number' && isFinite(rate) && rate > 0 ? rate : 1;
  }

  canNudgeRate(): boolean {
    return true;
  }

  busy(): boolean {
    if (this.player?.seeking?.() === true) {
      return true;
    }
    const ready = this.player?.readyState?.();
    return typeof ready === 'number' && ready < 3;
  }

  buffered(seconds: number): boolean {
    return isPositionBuffered(this.player?.buffered?.(), seconds);
  }

  paused(): boolean {
    return this.player?.paused?.() === true;
  }

  duration(): number | null {
    return finiteDuration(this.player?.duration?.());
  }
}

/**
 * Whether a position falls inside one of the buffered ranges.
 *
 * Unknown counts as buffered: guessing "not buffered" would force a seek, and seeking unnecessarily is the
 * behaviour being removed.
 */
/** A duration only counts if it is a real number: a live stream reports Infinity and a fresh player 0 or NaN. */
function finiteDuration(value: any): number | null {
  return typeof value === 'number' && isFinite(value) && value > 0 ? value : null;
}

function isPositionBuffered(ranges: any, seconds: number): boolean {
  if (!ranges || typeof ranges.length !== 'number' || ranges.length === 0) {
    return true;
  }

  for (let index = 0; index < ranges.length; index++) {
    try {
      if (seconds >= ranges.start(index) && seconds <= ranges.end(index)) {
        return true;
      }
    } catch {
      // A range can be invalidated between the length check and the read.
      return true;
    }
  }

  return false;
}

/** Wraps a plain HTMLMediaElement. */
export class MediaElementTarget implements PlaybackTarget {
  constructor(private readonly media: HTMLMediaElement) {}

  currentTime(): number | null {
    const time = this.media?.currentTime;
    return typeof time === 'number' && isFinite(time) ? time : null;
  }

  seekTo(seconds: number): void {
    this.media.currentTime = seconds;
  }

  setRate(rate: number): void {
    this.media.playbackRate = rate;
  }

  currentRate(): number {
    const rate = this.media?.playbackRate;
    return typeof rate === 'number' && isFinite(rate) && rate > 0 ? rate : 1;
  }

  canNudgeRate(): boolean {
    return true;
  }

  busy(): boolean {
    return this.media.seeking || this.media.readyState < 3;
  }

  buffered(seconds: number): boolean {
    return isPositionBuffered(this.media?.buffered, seconds);
  }

  paused(): boolean {
    return this.media.paused;
  }

  duration(): number | null {
    return finiteDuration(this.media?.duration);
  }
}

/**
 * Wraps the Twitch embed.
 *
 * It offers a position and a seek and nothing else: no rate control, no buffer information, no seeking
 * state. So it gets the wider tolerance and corrects by seeking, which is all it can do.
 */
export class TwitchTarget implements PlaybackTarget {
  constructor(private readonly player: any) {}

  currentTime(): number | null {
    const time = this.player?.getCurrentTime?.();
    return typeof time === 'number' && isFinite(time) ? time : null;
  }

  seekTo(seconds: number): void {
    this.player.seek(seconds);
  }

  setRate(): void {
    // Not offered by the embed.
  }

  currentRate(): number {
    return 1;
  }

  canNudgeRate(): boolean {
    return false;
  }

  busy(): boolean {
    return false;
  }

  buffered(): boolean {
    return true;
  }

  paused(): boolean {
    // The embed reports a state rather than a flag, and only for a live channel; treating a VOD as playing is
    // the safe answer because the decision only uses this to skip a correction it cannot make.
    return false;
  }

  duration(): number | null {
    const duration = this.player?.getDuration?.();
    return finiteDuration(duration);
  }
}
