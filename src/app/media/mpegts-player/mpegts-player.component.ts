import {AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild} from '@angular/core';
import {Subscription} from 'rxjs';
import mpegts from 'mpegts.js';
import {PlayerService} from '../../player/player-service/player.service';
import {PlaylistService} from '../../playlist/playlist-service/playlist.service';
import {LiveStreamService} from '../../live-stream-view/live-stream-service/live-stream.service';

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
/** How often to look again for a stream that is offline. */
const OFFLINE_RETRY_MS = 5000;
/** How long a stream that was playing may stay offline before the host moves the room on. */
const OFFLINE_GRACE_MS = 60000;
const FIRST_FRAME_TIMEOUT_MS = 10000;
/**
 * How long playback may stall before the connection is given up and made again. A publisher that goes away does
 * not end the connection: the streaming server keeps it open waiting for the stream to return, so the player
 * would otherwise sit on the last frame for good.
 */
const STALL_TIMEOUT_MS = 8000;
const VOLUME_KEY = 'livePlayerVolume';

/** The stream a live video's URL names: its stream parameter, or the last path segment of an RTMP URL. */
function streamNameOf(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const stream = parsed.searchParams.get('stream');
  if (stream) return stream;
  if (!parsed.protocol.startsWith('rtmp')) return null;
  const last = parsed.pathname.split('/').filter(Boolean).pop();
  return last ? decodeURIComponent(last) : null;
}

/**
 * Plays someone's OBS stream: the room's live video, or the stream on the /live page.
 *
 * Only the host's player used to recover from an error, by skipping to the next video; everyone else's froze.
 * Every player now reconnects, and the host moves the room on only once the stream is gone for good.
 */
@Component({
  selector: 'app-mpegts-player',
  templateUrl: './mpegts-player.component.html',
  styleUrls: ['./mpegts-player.component.scss']
})
export class MpegtsPlayerComponent implements AfterViewInit, OnDestroy {
  @Input() IsHost = true;
  @Input() UniqueId = '';
  /** Fires when the stream is offline; the /live page leaves on it. */
  @Output() NetworkError = new EventEmitter<void>();

  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;

  isPlaying = false;
  offline = false;
  refused = false;
  needsUnmute = false;
  controlsVisible = true;

  private player: mpegts.Player | null = null;
  private streamName: string | null = null;
  private attempt = 0;
  private failures = 0;
  private everPlayed = false;
  private offlineSince: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private firstFrameTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private controlsTimer: ReturnType<typeof setTimeout> | null = null;
  private subscription: Subscription | null = null;

  constructor(private playerService: PlayerService,
              private playlistService: PlaylistService,
              private liveStreamService: LiveStreamService) {}

  ngAfterViewInit(): void {
    this.loadVolume();
    this.subscription = this.playerService.player.subscribe(video => {
      const stream = streamNameOf(video?.url);
      if (!stream || stream === this.streamName) return;
      this.streamName = stream;
      this.refused = false;
      this.everPlayed = false;
      this.offlineSince = null;
      this.failures = 0;
      void this.connect();
    });
    this.showControls();
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
    if (this.controlsTimer !== null) clearTimeout(this.controlsTimer);
    this.disconnect();
  }

  private async connect(): Promise<void> {
    this.disconnect();
    const stream = this.streamName;
    if (!stream) return;

    const attempt = this.attempt;
    let url: string | null;
    try {
      url = await this.liveStreamService.playUrl(this.UniqueId || null, stream);
    } catch (err) {
      // Refused, which retrying will not change.
      if (attempt !== this.attempt) return;
      console.warn('[LivePlayer] the stream may not be watched', err);
      this.refused = true;
      this.NetworkError.emit();
      return;
    }
    if (attempt !== this.attempt) return;
    if (url === null) {
      this.goneOffline();
      return;
    }

    this.offline = false;
    this.offlineSince = null;
    const video = this.videoRef.nativeElement;
    const player = mpegts.createPlayer({type: 'flv', isLive: true, url}, {
      isLive: true,
      enableStashBuffer: true,
      // Closer to live than a shared file, since people react to a stream in the chat, but with enough buffer
      // that a small delay is not a stall.
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 4,
      liveBufferLatencyMinRemain: 1,
      autoCleanupSourceBuffer: true,
      lazyLoad: false
    });
    this.player = player;
    player.on(mpegts.Events.ERROR, (type: string, detail: string) => {
      console.warn('[LivePlayer] stream error', type, detail);
      this.onStreamLost(attempt);
    });
    player.on(mpegts.Events.LOADING_COMPLETE, () => this.onStreamLost(attempt));
    player.attachMediaElement(video);
    player.load();
    this.startPlayback(video);
    this.firstFrameTimer = setTimeout(() => {
      if (!this.isPlaying) this.onStreamLost(attempt);
    }, FIRST_FRAME_TIMEOUT_MS);
  }

  private startPlayback(video: HTMLVideoElement): void {
    video.play().catch((err: unknown) => {
      if (!(err instanceof DOMException) || err.name !== 'NotAllowedError') {
        console.warn('[LivePlayer] playback did not start', err);
        return;
      }
      // Sound needs an interaction with the page first; muted playback does not.
      video.muted = true;
      this.needsUnmute = true;
      video.play().catch(mutedErr => console.warn('[LivePlayer] muted playback did not start either', mutedErr));
    });
  }

  private onStreamLost(attempt: number): void {
    if (attempt !== this.attempt) return;
    this.disconnect();
    const delay = RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length - 1)];
    this.failures++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  /**
   * Nobody is streaming it right now. The host moves the room on from a stream that never came up, or that has
   * been gone for a minute; everyone else keeps looking for it while the room shows it.
   */
  private goneOffline(): void {
    this.offline = true;
    this.offlineSince ??= Date.now();
    this.NetworkError.emit();

    const givenUp = !this.everPlayed || Date.now() - this.offlineSince > OFFLINE_GRACE_MS;
    if (this.IsHost && this.UniqueId && givenUp) {
      this.playlistService.nextVideo(this.UniqueId);
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, OFFLINE_RETRY_MS);
  }

  private disconnect(): void {
    this.attempt++;
    this.isPlaying = false;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    if (this.firstFrameTimer !== null) clearTimeout(this.firstFrameTimer);
    if (this.stallTimer !== null) clearTimeout(this.stallTimer);
    this.retryTimer = null;
    this.firstFrameTimer = null;
    this.stallTimer = null;

    const player = this.player;
    this.player = null;
    if (player) {
      player.unload();
      player.detachMediaElement();
      player.destroy();
    }
  }

  onPlaying(): void {
    this.isPlaying = true;
    this.everPlayed = true;
    this.failures = 0;
    if (this.firstFrameTimer !== null) clearTimeout(this.firstFrameTimer);
    if (this.stallTimer !== null) clearTimeout(this.stallTimer);
    this.firstFrameTimer = null;
    this.stallTimer = null;
  }

  onWaiting(): void {
    this.isPlaying = false;
    if (!this.player || this.stallTimer !== null) return;
    const attempt = this.attempt;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      if (!this.isPlaying) this.onStreamLost(attempt);
    }, STALL_TIMEOUT_MS);
  }

  get statusText(): string | null {
    if (this.refused) return 'This stream cannot be watched here.';
    if (this.offline) return 'The stream is offline. Waiting for it to come back…';
    if (this.isPlaying) return null;
    return this.failures >= 2 ? 'Reconnecting to the stream…' : 'Loading the stream…';
  }

  /** Whether playback is within a second of the newest data. */
  isLive(): boolean {
    const video = this.videoRef?.nativeElement;
    if (!video || video.buffered.length === 0) return false;
    return video.currentTime + 1 >= video.buffered.end(video.buffered.length - 1);
  }

  seekLive(): void {
    const video = this.videoRef.nativeElement;
    if (video.buffered.length === 0) return;
    video.currentTime = video.buffered.end(video.buffered.length - 1) - 0.15;
  }

  unmute(): void {
    this.needsUnmute = false;
    this.videoRef.nativeElement.muted = false;
  }

  showControls(): void {
    this.controlsVisible = true;
    if (this.controlsTimer !== null) clearTimeout(this.controlsTimer);
    this.controlsTimer = setTimeout(() => this.controlsVisible = false, 2000);
  }

  onVolumeChange(): void {
    const video = this.videoRef.nativeElement;
    try {
      localStorage.setItem(VOLUME_KEY, String(video.muted ? 0 : video.volume));
    } catch (err) {
      console.warn('[LivePlayer] the volume could not be saved', err);
    }
  }

  private loadVolume(): void {
    let saved: number;
    try {
      saved = Number.parseFloat(localStorage.getItem(VOLUME_KEY) ?? '');
    } catch (err) {
      // Storage can be off, as in a private window; the volume then starts at its default.
      console.warn('[LivePlayer] the saved volume could not be read', err);
      return;
    }
    if (Number.isFinite(saved)) this.videoRef.nativeElement.volume = Math.min(1, Math.max(0, saved));
  }
}
