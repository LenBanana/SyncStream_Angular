import {AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {Subscription} from 'rxjs';
import {filter} from 'rxjs/operators';
import mpegts from 'mpegts.js';
import {
  RtmpAudioLanguagePreference,
  RtmpLocalMediaProbeResult,
  RtmpLocalMediaTrack,
  RtmpPlaybackPreferences,
  RtmpSubtitleMode,
  WebrtcService
} from '../webrtc/webrtc-service/webrtc.service';
import {LiveStreamService} from '../../live-stream-view/live-stream-service/live-stream.service';

/** How long a connection may take to show a frame before it is tried again. */
const FIRST_FRAME_TIMEOUT_MS = 10000;
/**
 * How long playback may stall before the connection is given up and made again. A publisher that goes away does
 * not end the connection: the streaming server keeps it open waiting for the stream to return, so the player
 * would otherwise sit on the last frame for good.
 */
const STALL_TIMEOUT_MS = 8000;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000];
const VOLUME_KEY = 'dreck-rtmp-fileshare-volume';

/**
 * Plays a file someone shares through RTMP, for the sharer and everyone else alike, and lets the sharer start,
 * pause, seek and stop it.
 *
 * Every pause, seek, wait for the upload and retry on the server ends one run of ffmpeg, and the next run is a
 * new stream whose timestamps start at zero again. A player that carried on across that would append the new
 * stream behind what it already had and stall, so the player connects afresh for each run.
 */
@Component({
  selector: 'app-rtmp-file-share-player',
  templateUrl: './rtmp-file-share-player.component.html',
  styleUrls: ['./rtmp-file-share-player.component.scss']
})
export class RtmpFileSharePlayerComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly audioLanguageOptions: Array<{ key: RtmpAudioLanguagePreference; label: string }> = [
    { key: 'japanese', label: 'Japanese' },
    { key: 'english', label: 'English' },
    { key: 'german', label: 'German' },
    { key: 'other', label: 'Other / default' }
  ];
  readonly subtitleModeOptions: Array<{ key: RtmpSubtitleMode; label: string; description: string }> = [
    {
      key: 'auto',
      label: 'Auto',
      description: 'Burn subtitles only when Japanese audio wins and a preferred subtitle track exists.'
    },
    {
      key: 'always',
      label: 'Always',
      description: 'Always burn the preferred subtitle track when one is available.'
    },
    {
      key: 'never',
      label: 'Never',
      description: 'Never burn subtitles into the RTMP stream.'
    }
  ];

  @Input() UniqueId: string = '';
  @Input() IsHost: boolean = false;

  @ViewChild('container') containerRef!: ElementRef<HTMLElement>;
  @ViewChild('playerVideo') playerVideoRef!: ElementRef<HTMLVideoElement>;

  // The share, as the server describes it
  sharerName = '';
  isStreamActive = false;
  isPaused = false;
  isBuffering = false;
  canSeek = false;
  duration: number | null = null;
  position = 0;

  // This player
  isPlaying = false;
  needsUnmute = false;
  volume = 1;
  muted = false;
  /** True while the sharer drags the position slider. */
  isSeeking = false;

  // Starting a share
  isLoading = false;
  uploadProgress = 0;
  /** How far reading the file's subtitles has got, 0 to 100; null when they are not being read. */
  subtitleProgress: number | null = null;
  isBackgroundUploading = false;
  isStopping = false;
  showPreferenceDialog = false;
  selectedSubtitleMode: RtmpSubtitleMode = 'auto';
  audioLanguagePriority: RtmpAudioLanguagePreference[] = ['japanese', 'english', 'german', 'other'];
  rtmpMediaProbe: RtmpLocalMediaProbeResult | null = null;
  isProbingRtmpMedia = false;
  rtmpMediaProbeError: string | null = null;
  selectedAudioOrdinal: number | null = null;
  selectedSubtitleOrdinal: number | null = null;
  pendingHostFile: File | null = null;

  private player: mpegts.Player | null = null;
  private streamName: string | null = null;
  private viewReady = false;
  /** Bumped on every connect and disconnect, so an attempt that has been overtaken ignores its own outcome. */
  private attempt = 0;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private firstFrameTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private positionTimer: ReturnType<typeof setInterval> | null = null;
  private positionBase = 0;
  private positionBaseAt = Date.now();
  private subs: Subscription[] = [];

  constructor(public webrtcService: WebrtcService, private liveStreamService: LiveStreamService) {}

  ngOnInit(): void {
    this.loadVolume();
    this.subs.push(
      this.webrtcService.rtmpFileShareActive.subscribe(info => {
        if (!info) {
          this.endShare();
          return;
        }
        this.isStreamActive = true;
        this.sharerName = info.username;
        this.duration = info.durationSec;
        if (info.streamName !== this.streamName) {
          this.streamName = info.streamName;
          this.disconnect();
        }
      }),
      this.webrtcService.rtmpFileShareIsPaused.subscribe(paused => {
        this.isPaused = paused;
        if (paused) this.disconnect();
        this.setPosition(this.position);
      }),
      this.webrtcService.rtmpFileShareState.subscribe(state => {
        // A run that ends to wait for the upload sends nothing more; the next run reconnects.
        if (state.buffering && !this.isBuffering) this.disconnect();
        this.isBuffering = state.buffering;
        if (!this.isSeeking) this.setPosition(state.positionSec);
      }),
      this.webrtcService.rtmpFileShareCanSeek.subscribe(canSeek => this.canSeek = canSeek),
      // What was buffered before a jump is not wanted after it.
      this.webrtcService.rtmpFileShareSeekSignal.subscribe(() => this.disconnect()),
      this.webrtcService.rtmpFileShareRun.pipe(filter(run => run > 0)).subscribe(() => {
        this.failures = 0;
        void this.connect();
      })
    );

    if (this.IsHost) {
      this.subs.push(
        this.webrtcService.pendingRtmpFileShareFile
          .pipe(filter((file): file is File => file !== null))
          .subscribe(file => {
            this.pendingHostFile = file;
            this.preparePendingHostShare(file);
          }),
        this.webrtcService.rtmpFileShareUploadProgress.subscribe(pct => this.uploadProgress = pct),
        this.webrtcService.rtmpFileShareSubtitleProgress.subscribe(fraction =>
          this.subtitleProgress = fraction === null ? null : Math.round(fraction * 100)),
        this.webrtcService.rtmpFileShareBackgroundUploadInProgress.subscribe(active => this.isBackgroundUploading = active)
      );
    }

    this.positionTimer = setInterval(() => this.advancePosition(), 250);
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    if (this.IsHost) this.preparePendingHostShare(this.pendingHostFile);
    if (this.webrtcService.rtmpFileShareRun.value > 0) void this.connect();
  }

  ngOnDestroy(): void {
    this.subs.forEach(subscription => subscription.unsubscribe());
    if (this.positionTimer !== null) clearInterval(this.positionTimer);
    this.disconnect();
  }

  // ── Playing the stream ──────────────────────────────────────────────────

  private async connect(): Promise<void> {
    this.disconnect();
    if (!this.viewReady || !this.streamName || !this.isStreamActive || this.isPaused || this.isBuffering) return;

    const attempt = this.attempt;
    let url: string | null;
    try {
      url = await this.liveStreamService.playUrl(this.UniqueId, this.streamName);
    } catch (err) {
      if (attempt !== this.attempt) return;
      console.warn('[RtmpFileShare] no play URL for the share', err);
      this.retryLater();
      return;
    }
    if (attempt !== this.attempt) return;
    // The share is gone; its end reaches this player as a notice of its own.
    if (url === null) return;

    const video = this.playerVideoRef.nativeElement;
    const player = mpegts.createPlayer({type: 'flv', isLive: true, url}, {
      isLive: true,
      // A shared file gains nothing from being a second closer to the server; a few seconds of buffer is what
      // keeps a passing network hiccup from becoming a stall. Latency is only pulled back once it has grown
      // past several seconds, which keeps viewers roughly together without skipping on every small delay.
      enableStashBuffer: true,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 6,
      liveBufferLatencyMinRemain: 2,
      // A film runs for hours; without this the media buffer fills until the browser refuses more.
      autoCleanupSourceBuffer: true,
      lazyLoad: false
    });
    this.player = player;
    player.on(mpegts.Events.ERROR, (type: string, detail: string) => {
      console.warn('[RtmpFileShare] stream error', type, detail);
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
        console.warn('[RtmpFileShare] playback did not start', err);
        return;
      }
      // The browser only lets a page start sound after someone interacted with it. Muted playback is always
      // allowed, so the picture starts and a button offers the sound.
      video.muted = true;
      this.muted = true;
      this.needsUnmute = true;
      video.play().catch(mutedErr => console.warn('[RtmpFileShare] muted playback did not start either', mutedErr));
    });
  }

  private onStreamLost(attempt: number): void {
    if (attempt !== this.attempt) return;
    this.disconnect();
    // A pause, seek or wait for the upload ends the run on purpose, and its notice can arrive just after the
    // stream does. Those cancel this retry; the next run connects by itself.
    this.retryLater();
  }

  private retryLater(): void {
    if (!this.isStreamActive || this.isPaused || this.isBuffering) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length - 1)];
    this.failures++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
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

  private endShare(): void {
    this.disconnect();
    this.isStreamActive = false;
    this.isPaused = false;
    this.isBuffering = false;
    this.canSeek = false;
    this.sharerName = '';
    this.streamName = null;
    this.duration = null;
    this.setPosition(0);
    this.showPreferenceDialog = false;
    this.isLoading = false;
  }

  onVideoPlaying(): void {
    this.isPlaying = true;
    this.failures = 0;
    if (this.firstFrameTimer !== null) clearTimeout(this.firstFrameTimer);
    if (this.stallTimer !== null) clearTimeout(this.stallTimer);
    this.firstFrameTimer = null;
    this.stallTimer = null;
  }

  onVideoWaiting(): void {
    this.isPlaying = false;
    if (!this.player || this.stallTimer !== null) return;
    const attempt = this.attempt;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      if (!this.isPlaying) this.onStreamLost(attempt);
    }, STALL_TIMEOUT_MS);
  }

  /** What the player is waiting for, to show over it; null when it is playing or paused. */
  get waitingFor(): string | null {
    if (!this.isStreamActive) return this.IsHost ? null : 'Connecting to the share…';
    if (this.isPaused) return null;
    if (this.isBuffering) return 'Waiting for more of the file to upload…';
    if (this.isPlaying) return null;
    return this.failures >= 2 ? 'Reconnecting to the stream…' : 'Loading the stream…';
  }

  // ── Position ────────────────────────────────────────────────────────────

  private setPosition(positionSec: number): void {
    this.position = positionSec;
    this.positionBase = positionSec;
    this.positionBaseAt = Date.now();
  }

  /** Moves the shown position along between the server's reports, while the share plays. */
  private advancePosition(): void {
    if (!this.isStreamActive || this.isPaused || this.isBuffering || this.isSeeking) return;
    const position = this.positionBase + (Date.now() - this.positionBaseAt) / 1000;
    this.position = this.duration != null ? Math.min(position, this.duration) : position;
  }

  get seekFillPercent(): number {
    if (!this.duration) return 0;
    return Math.min(100, (this.position / this.duration) * 100);
  }

  formatTime(sec: number | null | undefined): string {
    if (sec == null || !isFinite(sec) || sec < 0) return '--:--';
    const total = Math.floor(sec);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  // ── The sharer's controls ───────────────────────────────────────────────

  togglePlayPause(): void {
    if (!this.IsHost || !this.isStreamActive) return;
    void this.webrtcService.broadcastRtmpFileSharePlayPause(this.UniqueId, this.isPaused);
  }

  onSeekInput(event: Event): void {
    if (!this.IsHost) return;
    this.isSeeking = true;
    this.position = +(event.target as HTMLInputElement).value;
  }

  onSeekChange(event: Event): void {
    if (!this.IsHost) return;
    this.isSeeking = false;
    const target = +(event.target as HTMLInputElement).value;
    this.setPosition(target);
    void this.webrtcService.broadcastRtmpFileShareSeek(this.UniqueId, target);
  }

  async stopSharing(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;
    await this.webrtcService.stopRtmpFileShare(this.UniqueId);
    this.isStopping = false;
  }

  // ── Everyone's controls ─────────────────────────────────────────────────

  unmute(): void {
    this.needsUnmute = false;
    this.muted = false;
    this.saveVolume();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.needsUnmute = false;
    this.saveVolume();
  }

  onVolumeInput(event: Event): void {
    this.volume = +(event.target as HTMLInputElement).value;
    this.muted = this.volume === 0;
    this.needsUnmute = false;
    this.saveVolume();
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      this.containerRef.nativeElement.requestFullscreen()
        .catch(err => console.warn('[RtmpFileShare] fullscreen was refused', err));
    }
  }

  private loadVolume(): void {
    let saved: {volume?: unknown; muted?: unknown} | null;
    try {
      const raw = localStorage.getItem(VOLUME_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch (err) {
      // Storage can be off, as in a private window, or hold something unreadable; the volume then starts at
      // its default.
      console.warn('[RtmpFileShare] the saved volume could not be read', err);
      return;
    }
    if (typeof saved?.volume === 'number') this.volume = Math.min(1, Math.max(0, saved.volume));
    if (typeof saved?.muted === 'boolean') this.muted = saved.muted;
  }

  private saveVolume(): void {
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify({volume: this.volume, muted: this.muted}));
    } catch (err) {
      console.warn('[RtmpFileShare] the volume could not be saved', err);
    }
  }

  // ── Starting a share ────────────────────────────────────────────────────

  private preparePendingHostShare(file: File | null): void {
    if (!this.IsHost || !this.viewReady || !file || this.isLoading || this.isStreamActive) return;
    this.pendingHostFile = file;
    this.resetPreferenceForm();
    this.showPreferenceDialog = true;
    void this.beginLocalMediaProbe(file);
  }

  async confirmHostShareSettings(): Promise<void> {
    if (!this.pendingHostFile || this.isLoading || this.isStreamActive) return;
    const file = this.pendingHostFile;
    const selectedSubtitleTrack = this.getSelectedSubtitleTrack();
    const playbackPreferences: RtmpPlaybackPreferences = {
      subtitleMode: this.selectedSubtitleMode,
      audioLanguagePriority: [...this.audioLanguagePriority],
      selectedAudioOrdinal: this.selectedAudioOrdinal,
      selectedSubtitleOrdinal: this.selectedSubtitleMode === 'never' ? null : this.selectedSubtitleOrdinal,
      selectedSubtitleCodecName: this.selectedSubtitleMode === 'never' ? null : selectedSubtitleTrack?.codecName ?? null
    };

    this.pendingHostFile = null;
    this.showPreferenceDialog = false;
    this.webrtcService.clearPendingRtmpFileShareFile();
    await this.startHostShare(file, playbackPreferences);
  }

  cancelPendingHostShare(): void {
    this.showPreferenceDialog = false;
    this.pendingHostFile = null;
    this.webrtcService.cancelPreparingRtmpFileShare();
  }

  moveAudioLanguage(index: number, direction: -1 | 1): void {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= this.audioLanguagePriority.length) return;
    const next = [...this.audioLanguagePriority];
    const [item] = next.splice(index, 1);
    next.splice(targetIndex, 0, item);
    this.audioLanguagePriority = next;
  }

  getAudioLanguageLabel(language: RtmpAudioLanguagePreference): string {
    return this.audioLanguageOptions.find(option => option.key === language)?.label ?? language;
  }

  selectDetectedAudioTrack(ordinal: number | null): void {
    this.selectedAudioOrdinal = ordinal;
  }

  selectDetectedSubtitleTrack(track: RtmpLocalMediaTrack | null): void {
    if (!track) {
      this.selectedSubtitleOrdinal = null;
      return;
    }

    if (!track.burnable) return;
    this.selectedSubtitleOrdinal = track.ordinal;
    if (this.selectedSubtitleMode === 'never') {
      this.selectedSubtitleMode = 'always';
    }
  }

  getSelectedSubtitleTrack(): RtmpLocalMediaTrack | null {
    if (this.selectedSubtitleOrdinal == null) return null;
    return this.rtmpMediaProbe?.subtitleTracks.find(track => track.ordinal === this.selectedSubtitleOrdinal) ?? null;
  }

  trackByRtmpTrackOrdinal(_index: number, track: RtmpLocalMediaTrack): number {
    return track.ordinal;
  }

  private async beginLocalMediaProbe(file: File): Promise<void> {
    this.isProbingRtmpMedia = true;
    this.rtmpMediaProbeError = null;
    this.rtmpMediaProbe = null;
    this.selectedAudioOrdinal = null;
    this.selectedSubtitleOrdinal = null;

    try {
      const result = await this.webrtcService.probeRtmpFileTracks(file);
      if (this.pendingHostFile !== file || !this.showPreferenceDialog) return;

      this.rtmpMediaProbe = result;
      const firstBurnableSubtitle = result.subtitleTracks.find(track => track.burnable);
      this.selectedSubtitleOrdinal = firstBurnableSubtitle?.ordinal ?? null;
    } catch (err) {
      if (this.pendingHostFile !== file || !this.showPreferenceDialog) return;
      console.warn('[RtmpFileSharePlayer] local media probe failed:', err);
      this.rtmpMediaProbeError = 'Track detection failed. The stream can still start with automatic server selection.';
    } finally {
      if (this.pendingHostFile === file && this.showPreferenceDialog) {
        this.isProbingRtmpMedia = false;
      }
    }
  }

  private async startHostShare(file: File, playbackPreferences: RtmpPlaybackPreferences): Promise<void> {
    this.isLoading = true;
    try {
      await this.webrtcService.beginRtmpFileShare(file, this.UniqueId, playbackPreferences);
    } catch (err) {
      // Already shown to the sharer by the service, unless it was a cancel.
      console.warn('[RtmpFileSharePlayer] the share did not start:', err);
    } finally {
      this.isLoading = false;
    }
  }

  private resetPreferenceForm(): void {
    this.selectedSubtitleMode = 'auto';
    this.audioLanguagePriority = ['japanese', 'english', 'german', 'other'];
    this.rtmpMediaProbe = null;
    this.isProbingRtmpMedia = false;
    this.rtmpMediaProbeError = null;
    this.selectedAudioOrdinal = null;
    this.selectedSubtitleOrdinal = null;
  }
}
