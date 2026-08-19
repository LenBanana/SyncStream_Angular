import { AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import videojs from 'video.js';
import {
  RtmpAudioLanguagePreference,
  RtmpLocalMediaProbeResult,
  RtmpLocalMediaTrack,
  RtmpPlaybackPreferences,
  RtmpSubtitleMode,
  WebrtcService
} from '../webrtc/webrtc-service/webrtc.service';
import { getCookie } from '../../global.settings';
import mpegts from 'mpegts.js';
import type Player from 'video.js/dist/types/player';

type RtmpPlayerStatisticsInfo = {
  speed?: number;
  decodedFrames?: number;
  droppedFrames?: number;
  playerType?: string;
  [key: string]: unknown;
};

type RtmpPlayerMediaInfo = {
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  videoDataRate?: number;
  audioDataRate?: number;
  [key: string]: unknown;
};

type RtmpVideoFrameCallbackMetadata = {
  expectedDisplayTime?: number;
  mediaTime?: number;
  presentedFrames?: number;
  processingDuration?: number;
};

type RtmpVideoFrameSample = {
  nowMs: number;
  mediaTimeSec: number;
  presentedFrames: number;
};

type RtmpFrameTimingSummary = {
  callbackCount: number;
  presentedFramesDelta: number;
  lateCallbacks: number;
  irregularMediaGaps: number;
  maxCallbackGapMs: number;
  maxMediaGapMs: number;
  maxLateByMs: number;
  totalCallbackGapMs: number;
  totalMediaGapMs: number;
};

type RtmpVideoEventCounters = {
  waiting: number;
  stalled: number;
  playing: number;
  canplay: number;
  seeking: number;
  seeked: number;
};

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

  @ViewChild('playerVideo') playerVideoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('vodVideo') vodVideoRef!: ElementRef<HTMLVideoElement>;

  // Shared state
  sharerName: string = '';
  isStreamActive: boolean = false;
  isAwaitingStreamData: boolean = false;
  isPaused: boolean = false;
  loadError: string | null = null;

  // Host upload/loading state
  isLoading: boolean = false;
  isUploading: boolean = false;
  uploadProgress: number = 0;
  isBackgroundUploading: boolean = false;
  isStopping: boolean = false;
  showPreferenceDialog: boolean = false;
  selectedSubtitleMode: RtmpSubtitleMode = 'auto';
  audioLanguagePriority: RtmpAudioLanguagePreference[] = ['japanese', 'english', 'german', 'other'];
  rtmpMediaProbe: RtmpLocalMediaProbeResult | null = null;
  isProbingRtmpMedia: boolean = false;
  rtmpMediaProbeError: string | null = null;
  selectedAudioOrdinal: number | null = null;
  selectedSubtitleOrdinal: number | null = null;

  // Controls (host and viewer share the volume UI)
  hostPaused: boolean = false;
  hostVolume: number = 1;
  hostMuted: boolean = false;
  hostPosition: number = 0;
  hostDuration: number | null = null;
  canSeek: boolean = false;
  isSeeking: boolean = false;
  playbackMode: 'rtmp' | 'vod' = 'rtmp';

  private _viewInitialized = false;
  private _positionBase: number = 0;
  private _positionBaseAt: number = 0;
  private _positionInterval: any = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _awaitingStreamWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private _awaitingReason: 'start' | 'resume' | 'seek' | 'reconnect' | null = null;
  private _statsLogTimer: ReturnType<typeof setInterval> | null = null;
  private _lastStatisticsInfo: RtmpPlayerStatisticsInfo | null = null;
  private _lastMediaInfo: RtmpPlayerMediaInfo | null = null;
  private _lastPlaybackQualitySample: { totalFrames: number; droppedFrames: number; timestampMs: number } | null = null;
  private _frameCallbackHandle: number | null = null;
  private _lastVideoFrameSample: RtmpVideoFrameSample | null = null;
  private _frameTimingSummary: RtmpFrameTimingSummary = this.createEmptyFrameTimingSummary();
  private _videoEventCounters: RtmpVideoEventCounters = this.createEmptyVideoEventCounters();
  private _statusBannerText: string | null = null;
  private _statusBannerTimer: ReturnType<typeof setTimeout> | null = null;

  private player: mpegts.Player | null = null;
  private vodPlayer: Player | null = null;
  private streamUrl: string | null = null;
  pendingHostFile: File | null = null;
  private subs: Subscription[] = [];

  constructor(public webrtcService: WebrtcService) {}

  ngOnInit(): void {
    this.subs.push(
      this.webrtcService.rtmpFileShareActive.subscribe(info => {
        if (!info) {
          this.isStreamActive = false;
          this.isAwaitingStreamData = false;
          this._awaitingReason = null;
          this.sharerName = '';
          this.hostDuration = null;
          this.canSeek = false;
          this.playbackMode = 'rtmp';
          this.showPreferenceDialog = false;
          this.clearStatusBanner();
          this.stopPositionTracking();
          this.destroyPlayer();
          this.destroyVodPlayer();
          return;
        }

        const nextStreamUrl = this.buildAuthedUrl(info.streamUrl);
        const sameActiveStream =
          this.isStreamActive &&
          this.streamUrl === nextStreamUrl &&
          this.sharerName === info.username;

        if (sameActiveStream) {
          this.hostDuration = info.durationSec ?? this.hostDuration;
          if (this.playbackMode !== 'vod') {
            this.refreshHostDurationFromLocalProbe();
          }
          return;
        }

        this.sharerName = info.username;
        this.streamUrl = nextStreamUrl;
        this.hostDuration = info.durationSec ?? null;
        this.canSeek = false;
        this.playbackMode = 'rtmp';
        this.refreshHostDurationFromLocalProbe();
        this.isStreamActive = true;
        this.isAwaitingStreamData = true;
        this._awaitingReason = 'start';
        this.destroyVodPlayer();
        if (this._viewInitialized) {
          this.createPlayer(this.streamUrl);
          if (this.IsHost) {
            this.hostPosition = 0;
            this._positionBase = 0;
            this._positionBaseAt = 0;
            this.stopPositionTracking();
          }
        }
      }),

      this.webrtcService.rtmpFileShareIsPaused.subscribe(paused => {
        const wasPaused = this.isPaused;
        this.isPaused = paused;

        if (!this._viewInitialized || !this.streamUrl || !this.isStreamActive) {
          return;
        }

        if (paused) {
          this.clearReconnectTimer();
          this.isAwaitingStreamData = false;
          this._awaitingReason = null;
          this.destroyPlayer();
          return;
        }

        if (wasPaused) {
          this.isAwaitingStreamData = true;
          this._awaitingReason = 'resume';
          if (this._viewInitialized && this.streamUrl && !this.player) {
            this.createPlayer(this.streamUrl);
          }
        }
      }),

      this.webrtcService.rtmpFileShareSeekSignal.subscribe(positionSec => {
        if (this._viewInitialized && this.streamUrl) {
          this.hostPosition = positionSec;
          this.isAwaitingStreamData = true;
          this._awaitingReason = 'seek';
          this.destroyPlayer();
        }
      }),

      this.webrtcService.rtmpFileShareCanSeek.subscribe(canSeek => {
        const becameSeekable = canSeek && !this.canSeek;
        this.canSeek = canSeek;
        if (becameSeekable && this.isStreamActive && this.playbackMode === 'rtmp' && !this.isBackgroundUploading) {
          this.showStatusBanner('Upload complete. Normal playback is still being prepared.');
        }
      }),

      this.webrtcService.rtmpFileShareStreamReady.subscribe(positionSec => {
        this.hostPosition = positionSec;
        this._positionBase = positionSec;
        this._positionBaseAt = Date.now();

        if (!this.streamUrl || !this.isStreamActive || this.isPaused) {
          return;
        }

        if (this._viewInitialized && (!this.player || this.isAwaitingStreamData)) {
          this.createPlayer(this.streamUrl);
        }
      }),

      this.webrtcService.rtmpFileShareVodPlayback.subscribe(info => {
        if (!info) {
          if (this.playbackMode === 'vod') {
            this.playbackMode = 'rtmp';
            this.destroyVodPlayer();
          }
          return;
        }

        this.playbackMode = 'vod';
        this.canSeek = true;
        this.isPaused = false;
        this.hostPaused = false;
        this.isAwaitingStreamData = false;
        this._awaitingReason = null;
        this.clearReconnectTimer();
        this.clearAwaitingStreamWatchdog();
        this.stopPositionTracking();
        this.destroyPlayer();
        this.hostDuration = info.durationSec ?? this.hostDuration;
        const playbackUrl = this.buildAuthedUrl(info.playbackUrl);
        this.showStatusBanner('Upload complete. Switched to normal playback.');
        setTimeout(() => this.createVodPlayer(playbackUrl, info.contentType ?? null), 0);
      })
    );

    if (!this.IsHost) {
      // Viewers track position from server broadcasts.
      this.subs.push(
        this.webrtcService.rtmpFileSharePosition.subscribe(pos => {
          if (!this.isSeeking) this.hostPosition = pos;
        })
      );
    }

    if (this.IsHost) {
      this.subs.push(
        this.webrtcService.pendingRtmpFileShareFile
          .pipe(filter(f => f !== null))
          .subscribe(file => {
            this.pendingHostFile = file;
            this.preparePendingHostShare(file);
          }),
        this.webrtcService.rtmpFileShareUploadProgress.subscribe(pct => {
          this.uploadProgress = pct;
          this.refreshHostDurationFromLocalProbe();
        }),
        this.webrtcService.rtmpFileShareBackgroundUploadInProgress.subscribe(active => {
          this.isBackgroundUploading = active;
          if (!active) {
            this.refreshHostDurationFromLocalProbe();
          }
        })
      );
    }
  }

  ngAfterViewInit(): void {
    this._viewInitialized = true;

    if (this.IsHost) {
      this.refreshHostDurationFromLocalProbe();
      this.preparePendingHostShare(this.pendingHostFile);
    } else {
      const info = this.webrtcService.rtmpFileShareActive.value;
      if (info) {
        this.streamUrl = this.buildAuthedUrl(info.streamUrl);
        this.hostDuration = info.durationSec ?? null;
        this.canSeek = this.webrtcService.rtmpFileShareCanSeek.value;
        this.createPlayer(this.streamUrl);
      }
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.stopPositionTracking();
    this.clearReconnectTimer();
    this.clearStatusBanner();
    this.stopDiagnosticsLogging();
    this.destroyPlayer();
    this.destroyVodPlayer();
  }

  // ── Host: start share ─────────────────────────────────────────────────────

  private preparePendingHostShare(file: File | null): void {
    if (!this.IsHost || !this._viewInitialized || !file || this.isLoading || this.isStreamActive) return;
    this.pendingHostFile = file;
    this.resetPreferenceForm();
    this.showPreferenceDialog = true;
    this.beginLocalMediaProbe(file);
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
    this.isUploading = true;
    this.loadError = null;

    try {
      await this.webrtcService.beginRtmpFileShare(file, this.UniqueId, playbackPreferences);
      // rtmpFileShareStarted hub event fires → subscription above handles createPlayer + tracking
      this.isUploading = false;
      this.isLoading = false;
    } catch (err: any) {
      if (err?.message === 'Share was cancelled') return;
      console.error('[RtmpFileSharePlayer] startHostShare failed:', err);
      this.loadError = 'Failed to start the file share. Please try again.';
      this.isUploading = false;
      this.isLoading = false;
    }
  }

  // ── mpegts.js player ──────────────────────────────────────────────────────

  private createPlayer(url: string): void {
    this.destroyPlayer();
    this.clearReconnectTimer();
    this.clearAwaitingStreamWatchdog();
    if (!this.playerVideoRef) return;

    if (!mpegts.getFeatureList().mseLivePlayback) {
      this.loadError = 'Your browser does not support MSE live playback.';
      return;
    }

    const videoEl = this.playerVideoRef.nativeElement;
    this.isAwaitingStreamData = true;
    this.loadSavedVolume(videoEl);
    videoEl.addEventListener('volumechange', this.onVolumeChange);
    this.attachVideoDiagnostics(videoEl);

    this.player = mpegts.createPlayer(
      { type: 'flv', isLive: true, url, cors: true },
      {
        isLive: true,
        enableStashBuffer: false,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 1.5,
        liveBufferLatencyMinRemain: 0.3,
        lazyLoad: false
      }
    );
    this.player.attachMediaElement(videoEl);
    this.player.load();
    void Promise.resolve(this.player.play()).catch(() => {});
    this.startFrameDiagnostics(videoEl);
    this.scheduleAwaitingStreamWatchdog();

    console.info('[RtmpFileSharePlayer] player created', {
      role: this.IsHost ? 'host' : 'viewer',
      roomId: this.UniqueId,
      streamOwner: this.sharerName || null
    });

    this.player.on(mpegts.Events.MEDIA_INFO, (info: RtmpPlayerMediaInfo) => {
      this._lastMediaInfo = info;
      console.info('[RtmpFileSharePlayer] media info', info);
    });

    this.player.on(mpegts.Events.STATISTICS_INFO, (stats: RtmpPlayerStatisticsInfo) => {
      this._lastStatisticsInfo = stats;
      if ((stats.decodedFrames ?? 0) > 0) {
        this.markStreamReady();
      }
    });

    this.player.on(mpegts.Events.ERROR, (errorType: string, errorDetail: string, errorInfo: unknown) => {
      console.warn('[RtmpFileSharePlayer] mpegts error', { errorType, errorDetail, errorInfo });
      if (!this.streamUrl || !this.isStreamActive || this.isPaused) {
        return;
      }

      this.destroyPlayer();
      this.scheduleReconnect(1200);
    });

    this.startDiagnosticsLogging();
  }

  private destroyPlayer(): void {
    this.stopDiagnosticsLogging();
    this.clearAwaitingStreamWatchdog();
    if (this.player) {
      this.player.unload();
      this.player.destroy();
      this.player = null;
    }
    if (this.playerVideoRef) {
      this.detachVideoDiagnostics(this.playerVideoRef.nativeElement);
      this.playerVideoRef.nativeElement.removeEventListener('volumechange', this.onVolumeChange);
    }
  }

  private createVodPlayer(url: string, contentType: string | null): void {
    this.destroyVodPlayer();
    if (!this.vodVideoRef) return;

    const videoEl = this.vodVideoRef.nativeElement;
    this.vodPlayer = videojs(videoEl, {
      autoplay: 'play',
      controls: true,
      preload: 'auto',
      enableWorker: true,
      liveDurationInfinity: false,
      liveui: false
    });

    this.vodPlayer.ready(() => {
      const source = this.getVodSource(url, contentType);
      this.vodPlayer?.src({
        ...source,
        title: `${this.sharerName || 'Room share'} playback`
      });

      const resumeAt = this.hostPosition;
      if (resumeAt > 1) {
        this.vodPlayer?.one('loadedmetadata', () => {
          const duration = this.vodPlayer?.duration() ?? Number.POSITIVE_INFINITY;
          if (resumeAt < duration) {
            this.vodPlayer?.currentTime(resumeAt);
          }
        });
      }
    });
  }

  private destroyVodPlayer(): void {
    if (this.vodPlayer) {
      this.vodPlayer.dispose();
      this.vodPlayer = null;
    }
  }

  private markStreamReady(): void {
    if (!this.isStreamActive || !this.isAwaitingStreamData) {
      return;
    }

    this.isAwaitingStreamData = false;
    this._awaitingReason = null;
    this.loadError = null;
    this.clearAwaitingStreamWatchdog();
    if (this.IsHost && !this.hostPaused) {
      this._positionBase = this.hostPosition;
      this._positionBaseAt = Date.now();
      this.startPositionTracking();
    }
  }

  private refreshHostDurationFromLocalProbe(): void {
    if (!this.IsHost || this.hostDuration != null) {
      return;
    }

    const localDuration = this.webrtcService.rtmpShareFileDuration;
    if (localDuration != null && isFinite(localDuration) && localDuration > 0) {
      this.hostDuration = localDuration;
    }
  }

  private scheduleReconnect(delayMs: number): void {
    this.clearReconnectTimer();
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this.streamUrl && this.isStreamActive && !this.isPaused) {
        this._awaitingReason = 'reconnect';
        this.createPlayer(this.streamUrl);
      }
    }, delayMs);
  }

  private scheduleAwaitingStreamWatchdog(): void {
    this.clearAwaitingStreamWatchdog();
    this._awaitingStreamWatchdogTimer = setTimeout(() => {
      this._awaitingStreamWatchdogTimer = null;

      const shouldRetry =
        this.isStreamActive &&
        this.isAwaitingStreamData &&
        !this.isPaused &&
        !(this.IsHost && this.hostPaused) &&
        !!this.streamUrl;

      if (!shouldRetry) {
        return;
      }

      this.loadError = this._awaitingReason === 'seek'
        ? 'The stream is still restarting after the seek. This can happen while the transport catches up.'
        : 'The stream is taking longer than expected to become readable. Retrying…';

      console.warn('[RtmpFileSharePlayer] stream readiness timeout; retrying player attach', {
        role: this.IsHost ? 'host' : 'viewer',
        roomId: this.UniqueId,
        bufferedAheadSec: this.playerVideoRef ? this.getBufferedAhead(this.playerVideoRef.nativeElement) : null
      });

      this.destroyPlayer();
      this.scheduleReconnect(900);
    }, 2500);
  }

  private clearAwaitingStreamWatchdog(): void {
    if (this._awaitingStreamWatchdogTimer !== null) {
      clearTimeout(this._awaitingStreamWatchdogTimer);
      this._awaitingStreamWatchdogTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private showStatusBanner(text: string, durationMs: number = 6000): void {
    this._statusBannerText = text;
    if (this._statusBannerTimer !== null) {
      clearTimeout(this._statusBannerTimer);
    }
    this._statusBannerTimer = setTimeout(() => {
      this._statusBannerTimer = null;
      this._statusBannerText = null;
    }, durationMs);
  }

  private clearStatusBanner(): void {
    if (this._statusBannerTimer !== null) {
      clearTimeout(this._statusBannerTimer);
      this._statusBannerTimer = null;
    }
    this._statusBannerText = null;
  }

  private startDiagnosticsLogging(): void {
    if (this._statsLogTimer !== null) return;
    this._statsLogTimer = setInterval(() => {
      this.logPlaybackDiagnostics();
    }, 5000);
  }

  private stopDiagnosticsLogging(): void {
    if (this._statsLogTimer !== null) {
      clearInterval(this._statsLogTimer);
      this._statsLogTimer = null;
    }
    this._lastStatisticsInfo = null;
    this._lastMediaInfo = null;
    this._lastPlaybackQualitySample = null;
  }

  private logPlaybackDiagnostics(): void {
    if (!this.player || !this.playerVideoRef || !this.isStreamActive) {
      return;
    }

    const videoEl = this.playerVideoRef.nativeElement;
    const statistics = this._lastStatisticsInfo ?? this.player.statisticsInfo as RtmpPlayerStatisticsInfo;
    const mediaInfo = this._lastMediaInfo ?? this.player.mediaInfo as RtmpPlayerMediaInfo;
    const bufferedAheadSec = this.getBufferedAhead(videoEl);
    const playbackQuality = this.getPlaybackQualityDelta(videoEl);
    const frameTiming = this.consumeFrameTimingSummary(mediaInfo?.fps ?? null);
    const videoEvents = this.consumeVideoEventCounters();

    console.groupCollapsed(`[RTMP Stats] ${new Date().toLocaleTimeString()} ${this.sharerName || this.UniqueId}`);
    console.info('transport', {
      speedKbps: statistics?.speed ?? null,
      decodedFrames: statistics?.decodedFrames ?? null,
      droppedFrames: statistics?.droppedFrames ?? null,
      playerType: statistics?.playerType ?? null,
      bufferedAheadSec,
      currentTime: videoEl.currentTime,
      readyState: videoEl.readyState,
      paused: videoEl.paused,
      seeking: videoEl.seeking
    });
    console.info('media', {
      resolution: mediaInfo?.width && mediaInfo?.height ? `${mediaInfo.width}x${mediaInfo.height}` : null,
      fps: mediaInfo?.fps ?? null,
      videoCodec: mediaInfo?.videoCodec ?? null,
      audioCodec: mediaInfo?.audioCodec ?? null,
      videoDataRate: mediaInfo?.videoDataRate ?? null,
      audioDataRate: mediaInfo?.audioDataRate ?? null
    });
    if (playbackQuality) {
      console.info('videoPlaybackQuality', playbackQuality);
    }
    if (frameTiming) {
      console.info('frameTiming', frameTiming);
    }
    if (videoEvents) {
      console.info('videoEvents', videoEvents);
    }
    console.groupEnd();
  }

  private attachVideoDiagnostics(video: HTMLVideoElement): void {
    video.addEventListener('waiting', this.onVideoWaiting);
    video.addEventListener('stalled', this.onVideoStalled);
    video.addEventListener('playing', this.onVideoPlaying);
    video.addEventListener('canplay', this.onVideoCanPlay);
    video.addEventListener('seeking', this.onVideoSeeking);
    video.addEventListener('seeked', this.onVideoSeeked);
  }

  private detachVideoDiagnostics(video: HTMLVideoElement): void {
    this.stopFrameDiagnostics(video);
    video.removeEventListener('waiting', this.onVideoWaiting);
    video.removeEventListener('stalled', this.onVideoStalled);
    video.removeEventListener('playing', this.onVideoPlaying);
    video.removeEventListener('canplay', this.onVideoCanPlay);
    video.removeEventListener('seeking', this.onVideoSeeking);
    video.removeEventListener('seeked', this.onVideoSeeked);
  }

  private startFrameDiagnostics(video: HTMLVideoElement): void {
    this.stopFrameDiagnostics(video);
    this._lastVideoFrameSample = null;
    this._frameTimingSummary = this.createEmptyFrameTimingSummary();

    const frameVideo = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: (now: number, metadata: RtmpVideoFrameCallbackMetadata) => void) => number;
    };

    if (!frameVideo.requestVideoFrameCallback) {
      return;
    }

    const onFrame = (now: number, metadata: RtmpVideoFrameCallbackMetadata): void => {
      this.captureFrameTiming(now, metadata);
      this._frameCallbackHandle = frameVideo.requestVideoFrameCallback?.(onFrame) ?? null;
    };

    this._frameCallbackHandle = frameVideo.requestVideoFrameCallback(onFrame);
  }

  private stopFrameDiagnostics(video: HTMLVideoElement): void {
    const frameVideo = video as HTMLVideoElement & {
      cancelVideoFrameCallback?: (handle: number) => void;
    };

    if (this._frameCallbackHandle !== null) {
      frameVideo.cancelVideoFrameCallback?.(this._frameCallbackHandle);
      this._frameCallbackHandle = null;
    }

    this._lastVideoFrameSample = null;
    this._frameTimingSummary = this.createEmptyFrameTimingSummary();
    this._videoEventCounters = this.createEmptyVideoEventCounters();
  }

  private captureFrameTiming(now: number, metadata: RtmpVideoFrameCallbackMetadata): void {
    const mediaTimeSec = typeof metadata.mediaTime === 'number' ? metadata.mediaTime : null;
    const presentedFrames = typeof metadata.presentedFrames === 'number' ? metadata.presentedFrames : null;

    if (mediaTimeSec == null || presentedFrames == null) {
      return;
    }

    if (presentedFrames > 0) {
      this.markStreamReady();
    }

    const currentSample: RtmpVideoFrameSample = {
      nowMs: now,
      mediaTimeSec,
      presentedFrames
    };

    const previous = this._lastVideoFrameSample;
    this._lastVideoFrameSample = currentSample;

    if (!previous) {
      return;
    }

    const callbackGapMs = Math.max(0, currentSample.nowMs - previous.nowMs);
    const mediaGapMs = Math.max(0, (currentSample.mediaTimeSec - previous.mediaTimeSec) * 1000);
    const presentedFramesDelta = Math.max(0, currentSample.presentedFrames - previous.presentedFrames);
    const lateByMs = typeof metadata.expectedDisplayTime === 'number'
      ? Math.max(0, now - metadata.expectedDisplayTime)
      : 0;
    const expectedFrameGapMs = this._lastMediaInfo?.fps ? 1000 / this._lastMediaInfo.fps : 1000 / 24;

    this._frameTimingSummary.callbackCount += 1;
    this._frameTimingSummary.presentedFramesDelta += presentedFramesDelta;
    this._frameTimingSummary.totalCallbackGapMs += callbackGapMs;
    this._frameTimingSummary.totalMediaGapMs += mediaGapMs;
    this._frameTimingSummary.maxCallbackGapMs = Math.max(this._frameTimingSummary.maxCallbackGapMs, callbackGapMs);
    this._frameTimingSummary.maxMediaGapMs = Math.max(this._frameTimingSummary.maxMediaGapMs, mediaGapMs);
    this._frameTimingSummary.maxLateByMs = Math.max(this._frameTimingSummary.maxLateByMs, lateByMs);

    if (lateByMs > 12) {
      this._frameTimingSummary.lateCallbacks += 1;
    }

    if (mediaGapMs > expectedFrameGapMs * 1.5) {
      this._frameTimingSummary.irregularMediaGaps += 1;
    }
  }

  private consumeFrameTimingSummary(fpsHint: number | null): {
    callbackCount: number;
    presentedFramesDelta: number;
    avgCallbackGapMs: number | null;
    avgMediaGapMs: number | null;
    maxCallbackGapMs: number;
    maxMediaGapMs: number;
    lateCallbacks: number;
    maxLateByMs: number;
    irregularMediaGaps: number;
    fpsHint: number | null;
  } | null {
    const summary = this._frameTimingSummary;
    this._frameTimingSummary = this.createEmptyFrameTimingSummary();

    if (summary.callbackCount === 0) {
      return null;
    }

    return {
      callbackCount: summary.callbackCount,
      presentedFramesDelta: summary.presentedFramesDelta,
      avgCallbackGapMs: summary.callbackCount > 0 ? summary.totalCallbackGapMs / summary.callbackCount : null,
      avgMediaGapMs: summary.callbackCount > 0 ? summary.totalMediaGapMs / summary.callbackCount : null,
      maxCallbackGapMs: summary.maxCallbackGapMs,
      maxMediaGapMs: summary.maxMediaGapMs,
      lateCallbacks: summary.lateCallbacks,
      maxLateByMs: summary.maxLateByMs,
      irregularMediaGaps: summary.irregularMediaGaps,
      fpsHint
    };
  }

  private consumeVideoEventCounters(): RtmpVideoEventCounters | null {
    const counters = this._videoEventCounters;
    this._videoEventCounters = this.createEmptyVideoEventCounters();

    if (Object.values(counters).every(value => value === 0)) {
      return null;
    }

    return counters;
  }

  private createEmptyFrameTimingSummary(): RtmpFrameTimingSummary {
    return {
      callbackCount: 0,
      presentedFramesDelta: 0,
      lateCallbacks: 0,
      irregularMediaGaps: 0,
      maxCallbackGapMs: 0,
      maxMediaGapMs: 0,
      maxLateByMs: 0,
      totalCallbackGapMs: 0,
      totalMediaGapMs: 0
    };
  }

  private createEmptyVideoEventCounters(): RtmpVideoEventCounters {
    return {
      waiting: 0,
      stalled: 0,
      playing: 0,
      canplay: 0,
      seeking: 0,
      seeked: 0
    };
  }

  private buildVideoEventSnapshot(video: HTMLVideoElement): {
    currentTime: number;
    bufferedAheadSec: number | null;
    readyState: number;
    networkState: number;
    paused: boolean;
    seeking: boolean;
  } {
    return {
      currentTime: video.currentTime,
      bufferedAheadSec: this.getBufferedAhead(video),
      readyState: video.readyState,
      networkState: video.networkState,
      paused: video.paused,
      seeking: video.seeking
    };
  }

  private readonly onVideoWaiting = (event: Event): void => {
    this._videoEventCounters.waiting += 1;
    console.warn('[RtmpFileSharePlayer] video waiting', this.buildVideoEventSnapshot(event.target as HTMLVideoElement));
  };

  private readonly onVideoStalled = (event: Event): void => {
    this._videoEventCounters.stalled += 1;
    console.warn('[RtmpFileSharePlayer] video stalled', this.buildVideoEventSnapshot(event.target as HTMLVideoElement));
  };

  private readonly onVideoPlaying = (): void => {
    this._videoEventCounters.playing += 1;
    this.markStreamReady();
  };

  private readonly onVideoCanPlay = (): void => {
    this._videoEventCounters.canplay += 1;
    this.markStreamReady();
  };

  private readonly onVideoSeeking = (): void => {
    this._videoEventCounters.seeking += 1;
  };

  private readonly onVideoSeeked = (): void => {
    this._videoEventCounters.seeked += 1;
  };

  private getBufferedAhead(video: HTMLVideoElement): number | null {
    if (!video.buffered || video.buffered.length === 0) return null;
    const bufferedEnd = video.buffered.end(video.buffered.length - 1);
    return Math.max(0, bufferedEnd - video.currentTime);
  }

  private getPlaybackQualityDelta(video: HTMLVideoElement): { totalFrames: number; droppedFrames: number; droppedDelta: number; totalDelta: number } | null {
    const qualityFn = (video as HTMLVideoElement & {
      getVideoPlaybackQuality?: () => { totalVideoFrames: number; droppedVideoFrames: number };
    }).getVideoPlaybackQuality;

    if (!qualityFn) return null;

    const quality = qualityFn.call(video);
    const currentSample = {
      totalFrames: quality.totalVideoFrames,
      droppedFrames: quality.droppedVideoFrames,
      timestampMs: Date.now()
    };

    const previous = this._lastPlaybackQualitySample;
    this._lastPlaybackQualitySample = currentSample;

    return {
      totalFrames: currentSample.totalFrames,
      droppedFrames: currentSample.droppedFrames,
      droppedDelta: previous ? currentSample.droppedFrames - previous.droppedFrames : 0,
      totalDelta: previous ? currentSample.totalFrames - previous.totalFrames : 0
    };
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

  // ── Host controls ─────────────────────────────────────────────────────────

  togglePlayPause(): void {
    if (this.playbackMode !== 'rtmp') return;
    if (!this.isStreamActive) return;
    const wasPaused = this.hostPaused;
    this.hostPaused = !wasPaused;
    const isNowPlaying = !this.hostPaused;

    if (isNowPlaying) {
      this._positionBase = this.hostPosition;
      this._positionBaseAt = Date.now();
    } else {
      this.hostPosition = this._positionBase + (Date.now() - this._positionBaseAt) / 1000;
      this._positionBase = this.hostPosition;
      this.clearReconnectTimer();
      this.isAwaitingStreamData = false;
      this.destroyPlayer();
    }

    this.webrtcService.broadcastRtmpFileSharePlayPause(this.UniqueId, isNowPlaying)
      .then(() => {
        if (!isNowPlaying) {
          return;
        }

        this.isAwaitingStreamData = true;
        this._awaitingReason = 'resume';
        if (this.streamUrl && !this.player) {
          this.createPlayer(this.streamUrl);
        }
      })
      .catch(err => {
        console.error('togglePlayPause failed:', err);
        this.hostPaused = wasPaused;
        this._awaitingReason = null;

        if (!wasPaused && this.streamUrl) {
          this.isAwaitingStreamData = true;
          this.createPlayer(this.streamUrl);
        }
      });
  }

  onSeekInput(event: Event): void {
    if (this.playbackMode !== 'rtmp') return;
    this.isSeeking = true;
    this.hostPosition = +(event.target as HTMLInputElement).value;
  }

  onSeekChange(event: Event): void {
    if (this.playbackMode !== 'rtmp') return;
    this.isSeeking = false;
    const pos = +(event.target as HTMLInputElement).value;
    this.hostPosition = pos;
    this._positionBase = pos;
    this._positionBaseAt = Date.now();

    if (this.streamUrl) {
      this.isAwaitingStreamData = true;
      this._awaitingReason = 'seek';
      this.destroyPlayer();
    }

    this.webrtcService.broadcastRtmpFileShareSeek(this.UniqueId, pos)
      .then(() => {
        this.hostPaused = false;
      })
      .catch(() => {
        this._awaitingReason = null;
        if (this.streamUrl) {
          this.createPlayer(this.streamUrl);
        }
      });
  }

  toggleMute(): void {
    this.hostMuted = !this.hostMuted;
    const video = this.playerVideoRef?.nativeElement;
    if (video) video.muted = this.hostMuted;
  }

  onVolumeInput(event: Event): void {
    const vol = +(event.target as HTMLInputElement).value;
    this.hostVolume = vol;
    this.hostMuted = vol === 0;
    const video = this.playerVideoRef?.nativeElement;
    if (video) {
      video.volume = vol;
      video.muted = vol === 0;
    }
  }

  toggleFullscreen(): void {
    const el = this.playerVideoRef?.nativeElement;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }

  async stopSharing(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;
    this.stopPositionTracking();
    await this.webrtcService.stopRtmpFileShare(this.UniqueId);
    this.isStopping = false;
  }

  // ── Position tracking (host) ──────────────────────────────────────────────

  private startPositionTracking(): void {
    this.stopPositionTracking();
    this._positionInterval = setInterval(() => {
      if (!this.hostPaused && !this.isSeeking) {
        this.hostPosition = this._positionBase + (Date.now() - this._positionBaseAt) / 1000;
        if (this.hostDuration != null) {
          this.hostPosition = Math.min(this.hostPosition, this.hostDuration);
        }
      }
    }, 250);
  }

  private stopPositionTracking(): void {
    if (this._positionInterval != null) {
      clearInterval(this._positionInterval);
      this._positionInterval = null;
    }
  }

  // ── Volume persistence ────────────────────────────────────────────────────

  private static readonly VOLUME_KEY = 'dreck-rtmp-fileshare-volume';

  private loadSavedVolume(video: HTMLVideoElement): void {
    try {
      const raw = localStorage.getItem(RtmpFileSharePlayerComponent.VOLUME_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.volume === 'number') video.volume = Math.min(1, Math.max(0, s.volume));
      if (typeof s.muted === 'boolean') video.muted = s.muted;
    } catch {}
  }

  private readonly onVolumeChange = (e: Event): void => {
    const video = e.target as HTMLVideoElement;
    try {
      localStorage.setItem(RtmpFileSharePlayerComponent.VOLUME_KEY,
        JSON.stringify({ volume: video.volume, muted: video.muted }));
    } catch {}
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildAuthedUrl(baseUrl: string): string {
    const token = getCookie('login-token');
    if (!token) {
      return baseUrl;
    }

    if ((baseUrl.includes('/api/rtmp/liveProxy') || baseUrl.includes('live.drecktu.be')) && !/[?&]token=/.test(baseUrl)) {
      let url = this.appendQueryParam(baseUrl, 'app', 'live');
      url = this.appendQueryParam(url, 'port', '1935');
      return this.appendQueryParam(url, 'token', token);
    }

    if ((baseUrl.includes('/api/video/fileByToken') || baseUrl.includes('/api/video/roomUploadByToken')) && !/[?&]token=/.test(baseUrl)) {
      return this.appendQueryParam(baseUrl, 'token', token);
    }

    return baseUrl;
  }

  private appendQueryParam(url: string, key: string, value: string): string {
    if (new RegExp(`[?&]${key}=`).test(url)) {
      return url;
    }

    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${key}=${encodeURIComponent(value)}`;
  }

  private getVodSource(url: string, contentType: string | null): { src: string; type?: string } {
    const normalizedUrl = url.toLowerCase();
    if (normalizedUrl.includes('/hlssegment/') || normalizedUrl.includes('.m3u8')) {
      return { src: url, type: 'application/x-mpegURL' };
    }

    if (contentType) {
      return { src: url, type: contentType };
    }

    return { src: url };
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

  getAwaitingCopy(): string {
    if (this.playbackMode === 'vod') {
      return 'Preparing normal playback…';
    }

    switch (this._awaitingReason) {
      case 'resume':
        return 'Waiting for playback to resume…';
      case 'seek':
        return 'Seeking and waiting for the stream to restart…';
      case 'reconnect':
        return 'Reconnecting to the stream…';
      default:
        return this.IsHost ? 'Waiting for the RTMP stream to become readable…' : 'Waiting for stream data…';
    }
  }

  get seekFillPercent(): number {
    if (!this.hostDuration) return 0;
    return Math.min(100, (this.hostPosition / this.hostDuration) * 100);
  }

  get isPreparingNormalPlayback(): boolean {
    return false;
  }

  get statusBannerText(): string | null {
    return this._statusBannerText;
  }
}
