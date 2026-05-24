import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import {Subscription} from 'rxjs';
import {filter} from 'rxjs/operators';
import {WebrtcService} from '../webrtc/webrtc-service/webrtc.service';

@Component({
  selector: 'app-file-share-player',
  templateUrl: './file-share-player.component.html',
  styleUrls: ['./file-share-player.component.scss']
})
export class FileSharePlayerComponent implements OnInit, AfterViewInit, OnDestroy {
  /** The room this player is associated with. */
  @Input() UniqueId: string = '';
  /**
   * True when this client is the one sharing the file.
   * Passed from media.component using webRtcService.isFileShareHost so it reflects
   * the actual share initiator, not just the room host.
   */
  @Input() IsHost: boolean = false;

  // ── Host: local video element ────────────────────────────────────────────
  @ViewChild('localVideo') localVideoRef!: ElementRef<HTMLVideoElement>;
  // ── Viewer: remote SFU stream element ────────────────────────────────────
  @ViewChild('remoteVideo') remoteVideoRef!: ElementRef<HTMLVideoElement>;

  // ── UI state ──────────────────────────────────────────────────────────────
  sharerName: string = '';
  /** Host: true until the video metadata is loaded and capture is started. */
  isLoading: boolean = false;
  /** Host: set when the file cannot be played (unsupported codec / container). */
  loadError: string | null = null;
  /** Viewer: stream is buffering / not yet arrived. */
  isPaused: boolean = false;
  hasRemoteStream: boolean = false;
  isStopping: boolean = false;
  /** Host: true while uploading the file to the server for the ffmpeg path. */
  isUploading: boolean = false;
  /** Host: upload progress 0-100 shown during server-side upload. */
  uploadProgress: number = 0;
  /** Host: true once the server-side ffmpeg pipeline is active.
   * In this mode the host watches via remoteVideo (same as viewers).
   */
  isServerShareMode: boolean = false;
  /** Host: true while the background chunk upload is still running after the stream went live. */
  isBackgroundUploading: boolean = false;
  /**
   * Server-mode host: tracks the requested play/pause state of the ffmpeg pipeline.
   * The hub's FileSharePlayPause excludes the caller from the broadcast, so we cannot
   * rely on the fileShareIsPaused subject to reflect our own clicks — track it locally.
   */
  serverHostPaused: boolean = false;
  /** Server-mode host: current volume level 0–1 for the volume slider. */
  serverHostVolume: number = 1;
  /** Server-mode host: whether the video is muted. */
  serverHostMuted: boolean = false;
  /** Server-mode host: current playback position in seconds (locally tracked). */
  serverHostPosition: number = 0;
  /** Server-mode host: total duration in seconds (from probe; null if unknown). */
  serverHostDuration: number | null = null;
  /** True while the user is actively dragging the seek slider (freeze display). */
  serverHostSeeking: boolean = false;

  private _positionBase: number = 0;    // seconds at last play start or seek
  private _positionBaseAt: number = 0;  // Date.now() at _positionBase
  private _positionInterval: any = null;

  private localObjectUrl: string | null = null;
  private subs: Subscription[] = [];
  private captureStarted = false;
  private pendingHostFile: File | null = null;

  constructor(public webrtcService: WebrtcService) {}

  ngOnInit(): void {
    this.subs.push(
      this.webrtcService.fileShareActive.subscribe(info => {
        this.sharerName = info?.username ?? '';
      }),
      this.webrtcService.fileShareIsPaused.subscribe(paused => {
        this.isPaused = paused;
      })
    );

    if (this.IsHost) {
      this.subs.push(
        this.webrtcService.pendingFileShareFile
          .pipe(filter(file => file !== null))
          .subscribe(file => {
            this.pendingHostFile = file;
            this.maybeStartPendingHostShare();
          }),
        this.webrtcService.fileShareUploadProgress.subscribe(pct => {
          this.uploadProgress = pct;
        }),
        this.webrtcService.backgroundUploadInProgress.subscribe(active => {
          this.isBackgroundUploading = active;
        }),
        this.webrtcService.serverShareUploadError.subscribe(msg => {
          // The background upload failed unrecoverably while the stream is live.
          // Show an overlay warning but do NOT auto-stop — ffmpeg can still serve
          // the portion already on disk; viewers may still be watching.
          console.warn('[FileSharePlayer] Background upload error:', msg);
          this.loadError = msg;
        })
      );
    }

    // Attach the SFU stream for viewers and for server-mode hosts.
    // (Server-mode host joins as a consumer, so they also receive via remoteStream.)
    // NOTE: no IsHost/isServerShareMode guard here — the #remoteVideo element is
    // always in the DOM (hidden via [class.d-none]) so attachRemoteStream can set
    // srcObject at any time, even before isServerShareMode is true.
    this.subs.push(
      this.webrtcService.remoteStream.subscribe(stream => {
        if (stream) {
          this.hasRemoteStream = true;
          this.attachRemoteStream(stream);
        } else {
          this.hasRemoteStream = false;
          this.detachRemoteStream();
        }
      })
    );
  }

  ngAfterViewInit(): void {
    if (this.IsHost) {
      this.maybeStartPendingHostShare();
    }

    // Attach any stream that arrived before this component rendered.
    // #remoteVideo is always in the DOM so this is safe for all modes.
    const stream = this.webrtcService.remoteStream.value;
    if (stream) {
      this.hasRemoteStream = true;
      this.attachRemoteStream(stream);
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.stopPositionTracking();
    if (this.IsHost && !this.isServerShareMode) {
      const videoEl = this.localVideoRef?.nativeElement;
      if (videoEl) {
        videoEl.removeEventListener('play', this.onHostPlay);
        videoEl.removeEventListener('pause', this.onHostPause);
        videoEl.removeEventListener('ended', this.onHostEnded);
      }
    }
    this.detachRemoteStream();
    this.revokeObjectUrl();
  }

  // ── Host: start the share ─────────────────────────────────────────────────

  private inferFileShareBitrate(videoEl: HTMLVideoElement): number {
    const width = videoEl.videoWidth || 1280;
    const height = videoEl.videoHeight || 720;
    const pixels = width * height;

    // Targets are calibrated for VP8 real-time encode from a captureStream source.
    // Higher values cause excessive CPU load from the simultaneous decode+encode pipeline.
    if (pixels >= 3840 * 2160) return 12_000_000;
    if (pixels >= 2560 * 1440) return  7_000_000;
    if (pixels >= 1920 * 1080) return  5_000_000;
    if (pixels >= 1280 * 720)  return  3_000_000;
    return 1_500_000;
  }

  // Extensions that Chrome/Edge cannot natively decode — skip the browser-load
  // attempt entirely and go straight to the server-side ffmpeg path.
  private static readonly SERVER_PATH_EXTENSIONS = new Set([
    'mkv', 'hevc', 'ts', 'm2ts', 'mts', 'flv', 'wmv', 'asf', 'rm', 'rmvb', 'divx',
  ]);

  private static needsServerPath(file: File): boolean {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    return FileSharePlayerComponent.SERVER_PATH_EXTENSIONS.has(ext);
  }

  private async initiateHostShare(file: File): Promise<void> {
    if (this.captureStarted) return;

    if (FileSharePlayerComponent.needsServerPath(file)) {
      console.info('FileSharePlayer: extension indicates server-side decode required — skipping browser load.');
      this.captureStarted = true;
      this.isLoading = true;
      this.loadError = null;
      await this.startServerPath(file);
      return;
    }

    this.captureStarted = true;
    this.isLoading = true;
    this.loadError = null;

    const videoEl = this.localVideoRef.nativeElement;
    this.localObjectUrl = URL.createObjectURL(file);
    videoEl.src = this.localObjectUrl;
    videoEl.muted = false;

    // Wait for loadedmetadata (readyState HAVE_METADATA): the browser has parsed
    // the container header and knows codec, dimensions, and track count.  This is
    // significantly earlier than loadeddata (which requires decoding the first frame)
    // and avoids the long pause that large MKV files cause when Chrome's demuxer
    // has to walk the EBML structure to find the first video cluster.
    // videoWidth / videoHeight are already valid at loadedmetadata, so bitrate
    // inference works correctly.  captureStream() returns a live MediaStream whose
    // tracks begin emitting frames as soon as videoEl.play() is called.
    const loadOk = await new Promise<boolean>(resolve => {
      const onLoaded = () => {
        videoEl.removeEventListener('loadedmetadata', onLoaded);
        videoEl.removeEventListener('error', onError);
        resolve(true);
      };
      const onError = () => {
        videoEl.removeEventListener('loadedmetadata', onLoaded);
        videoEl.removeEventListener('error', onError);
        resolve(false);
      };
      videoEl.addEventListener('loadedmetadata', onLoaded, {once: true});
      videoEl.addEventListener('error', onError, {once: true});
      videoEl.load();
    });

    if (!loadOk) {
      const code = (videoEl.error?.code ?? 0);
      // MEDIA_ERR_SRC_NOT_SUPPORTED = 4, MEDIA_ERR_DECODE = 3 → fall back to server-side ffmpeg path.
      if (code === 4 || code === 3) {
        console.info('FileSharePlayer: browser cannot play this codec — falling back to server-side stream.');
        this.resetHostPickerState(videoEl);
        await this.startServerPath(file);
        return;
      }
      console.error('FileSharePlayer: file failed to load. MediaError code:', code);
      this.loadError = 'The file could not be loaded.';
      this.resetHostPickerState(videoEl);
      return;
    }

    // captureStream() with no argument uses the video's native frame rate (e.g. 24, 25, 30,
    // 60 fps) exactly.  Passing a number is an upper-cap: it would not raise fps beyond
    // the source, but would incorrectly cap higher-fps sources.  Omitting it is correct.
    const captureStream: MediaStream | undefined =
      (videoEl as any).captureStream?.() ?? (videoEl as any).mozCaptureStream?.();

    if (!captureStream) {
      console.error('FileSharePlayer: captureStream() is not supported in this browser.');
      this.loadError = 'Your browser does not support capturing a local video stream (captureStream is missing).';
      this.resetHostPickerState(videoEl);
      return;
    }

    // Start playing locally so the capture picks up frames immediately.
    await videoEl.play().catch(e => console.warn('FileSharePlayer: autoplay blocked', e));

    this.isLoading = false;

    // Set up the SFU transport and notify the server / room.
    try {
      await this.webrtcService.startFileShare(this.UniqueId, captureStream, this.inferFileShareBitrate(videoEl));
    } catch (err) {
      console.error('FileSharePlayer: startFileShare failed.', err);
      this.resetHostPickerState(videoEl);
      return;
    }

    // Wire up host control events so play/pause is broadcast to viewers.
    videoEl.addEventListener('play', this.onHostPlay);
    videoEl.addEventListener('pause', this.onHostPause);
    videoEl.addEventListener('ended', this.onHostEnded);
  }

  // ── Host: event handlers ──────────────────────────────────────────────────

  private onHostPlay = (): void => {
    this.webrtcService.broadcastFileSharePlayPause(this.UniqueId, true).catch(() => {});
  };

  private onHostPause = (): void => {
    if (!this.isStopping) {
      this.webrtcService.broadcastFileSharePlayPause(this.UniqueId, false).catch(() => {});
    }
  };

  private onHostEnded = (): void => {
    this.stopSharing();
  };

  /**
   * Uploads the file and starts the server-side ffmpeg→mediasoup pipeline.
   * On success the host becomes a consumer of the SFU stream (isServerShareMode = true).
   */
  private async startServerPath(file: File): Promise<void> {
    this.captureStarted = true;
    this.isLoading = true;
    this.isUploading = true;
    this.loadError = null;

    try {
      // beginServerFileShare uploads the first chunk, starts ffmpeg, then continues
      // uploading the remainder in the background while viewers already watch.
      await this.webrtcService.beginServerFileShare(file, this.UniqueId);

      this.isUploading = false;
      this.isServerShareMode = true;
      this.isLoading = false;
      this.serverHostDuration = this.webrtcService.serverShareFileDuration;
      this.serverHostPosition = 0;
      this._positionBase = 0;
      this._positionBaseAt = Date.now();
      this.startPositionTracking();

      // Re-apply the stream in case it arrived before isServerShareMode was set.
      // #remoteVideo is always in the DOM, so attachRemoteStream works immediately.
      const stream = this.webrtcService.remoteStream.value;
      if (stream) {
        this.hasRemoteStream = true;
        this.attachRemoteStream(stream);
      }
      // If stream hasn't arrived yet the remoteStream subscription will handle it.
    } catch (err: any) {
      if (err?.message === 'Share was cancelled') return;
      console.error('FileSharePlayer: server-path failed:', err);
      this.loadError = 'Failed to stream the file via the server. Please try a supported format.';
      this.isUploading = false;
      this.isLoading = false;
      this.captureStarted = false;
      this.isServerShareMode = false;
    }
  }

  /**
   * Server-mode host: toggle play/pause of the ffmpeg pipeline.
   * Also pauses/resumes the local video element so the browser UI stays in sync.
   */
  toggleServerHostPlayPause(): void {
    if (!this.isServerShareMode) return;
    const wasPaused = this.serverHostPaused;
    this.serverHostPaused = !wasPaused;
    const isNowPlaying = !this.serverHostPaused;

    if (isNowPlaying) {
      // Resuming: update timing base so position continues from where it was.
      this._positionBase = this.serverHostPosition;
      this._positionBaseAt = Date.now();
      // Do NOT call video.play() here.  The video element is already in "playing"
      // state from initial attach.  For a live MediaStream, the element naturally
      // freezes when no RTP frames arrive (ffmpeg SIGSTOP'd) and naturally resumes
      // when they do — no play()/pause() calls required.
    } else {
      // Pausing: snapshot position so seek slider stays correct while paused.
      this.serverHostPosition = this._positionBase + (Date.now() - this._positionBaseAt) / 1000;
      this._positionBase = this.serverHostPosition;
      // Do NOT call video.pause() — it causes Chrome to show exactly one frame on
      // resume then re-freeze, because play() on a stale live stream is unreliable.
    }

    this.webrtcService.broadcastFileSharePlayPause(this.UniqueId, isNowPlaying)
      .catch(err => {
        console.error('toggleServerHostPlayPause failed:', err);
        // Roll back on failure.
        this.serverHostPaused = wasPaused;
      });
  }

  /** Called while the user drags the seek slider — update display only, no network call. */
  onServerHostSeekInput(event: Event): void {
    this.serverHostSeeking = true;
    this.serverHostPosition = +(event.target as HTMLInputElement).value;
  }

  /** Called when the user releases the seek slider — send seek to server. */
  onServerHostSeekChange(event: Event): void {
    this.serverHostSeeking = false;
    const pos = +(event.target as HTMLInputElement).value;
    this.serverHostPosition = pos;
    this._positionBase = pos;
    this._positionBaseAt = Date.now();
    this.webrtcService.broadcastFileShareSeek(this.UniqueId, pos).catch(() => {});
    // Resume playback after seek if currently paused.
    if (this.serverHostPaused) {
      this.serverHostPaused = false;
      this.webrtcService.broadcastFileSharePlayPause(this.UniqueId, true).catch(() => {});
    }
  }

  toggleServerHostMute(): void {
    this.serverHostMuted = !this.serverHostMuted;
    const video = this.remoteVideoRef?.nativeElement;
    if (video) video.muted = this.serverHostMuted;
  }

  onServerHostVolumeInput(event: Event): void {
    const vol = +(event.target as HTMLInputElement).value;
    this.serverHostVolume = vol;
    this.serverHostMuted = vol === 0;
    const video = this.remoteVideoRef?.nativeElement;
    if (video) {
      video.volume = vol;
      video.muted = vol === 0;
    }
  }

  toggleServerHostFullscreen(): void {
    const el = this.remoteVideoRef?.nativeElement;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }

  /** Format seconds as m:ss or h:mm:ss. Returns '--:--' when null/NaN. */
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

  get seekFillPercent(): number {
    if (!this.serverHostDuration) return 0;
    return Math.min(100, (this.serverHostPosition / this.serverHostDuration) * 100);
  }

  private startPositionTracking(): void {
    this.stopPositionTracking();
    this._positionInterval = setInterval(() => {
      if (!this.serverHostPaused && !this.serverHostSeeking) {
        this.serverHostPosition = this._positionBase + (Date.now() - this._positionBaseAt) / 1000;
        if (this.serverHostDuration != null) {
          this.serverHostPosition = Math.min(this.serverHostPosition, this.serverHostDuration);
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

  /** Stop sharing — called by the Stop button or when the video ends. */
  async stopSharing(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;

    if (this.isServerShareMode) {
      this.stopPositionTracking();
      await this.webrtcService.stopFileShare(this.UniqueId);
      this.isServerShareMode = false;
      this.serverHostPaused = false;
      this.serverHostVolume = 1;
      this.serverHostMuted = false;
      this.serverHostDuration = null;
      this.serverHostPosition = 0;
      this.captureStarted = false;
      this.isLoading = false;
      this.isStopping = false;
      return;
    }

    const videoEl = this.localVideoRef?.nativeElement;
    if (videoEl) {
      videoEl.removeEventListener('play', this.onHostPlay);
      videoEl.removeEventListener('pause', this.onHostPause);
      videoEl.removeEventListener('ended', this.onHostEnded);
      videoEl.pause();
    }
    await this.webrtcService.stopFileShare(this.UniqueId);
    this.resetHostPickerState(videoEl);
    this.isStopping = false;
  }

  // ── Viewer helpers ────────────────────────────────────────────────────────

  private static readonly VOLUME_KEY = 'dreck-fileshare-volume';

  private loadViewerVolume(video: HTMLVideoElement): void {
    try {
      const raw = localStorage.getItem(FileSharePlayerComponent.VOLUME_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.volume === 'number') video.volume = Math.min(1, Math.max(0, s.volume));
      if (typeof s.muted  === 'boolean') video.muted  = s.muted;
    } catch {}
  }

  private readonly onViewerVolumeChange = (e: Event): void => {
    const video = e.target as HTMLVideoElement;
    try {
      localStorage.setItem(FileSharePlayerComponent.VOLUME_KEY,
        JSON.stringify({volume: video.volume, muted: video.muted}));
    } catch {}
  };

  private attachRemoteStream(stream: MediaStream): void {
    if (!this.remoteVideoRef) return;
    const video = this.remoteVideoRef.nativeElement;
    this.loadViewerVolume(video);
    video.addEventListener('volumechange', this.onViewerVolumeChange);
    video.srcObject = stream;
    video.play().catch(() => {});
  }

  private detachRemoteStream(): void {
    if (!this.remoteVideoRef) return;
    const video = this.remoteVideoRef.nativeElement;
    video.removeEventListener('volumechange', this.onViewerVolumeChange);
    video.pause();
    video.srcObject = null;
  }

  // ── Viewer: quality controls ──────────────────────────────────────────────

  setQualityLow(): void {
    for (const id of this.webrtcService.getSfuConsumerIds()) {
      this.webrtcService.setPreferredLayers(this.UniqueId, id, 0, 0).catch(() => {});
    }
  }

  setQualityMedium(): void {
    for (const id of this.webrtcService.getSfuConsumerIds()) {
      this.webrtcService.setPreferredLayers(this.UniqueId, id, 1, 2).catch(() => {});
    }
  }

  setQualityHigh(): void {
    for (const id of this.webrtcService.getSfuConsumerIds()) {
      this.webrtcService.setPreferredLayers(this.UniqueId, id, 2, 2).catch(() => {});
    }
  }

  toggleFullscreen(): void {
    const el = this.IsHost
      ? this.localVideoRef?.nativeElement
      : this.remoteVideoRef?.nativeElement;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  private revokeObjectUrl(): void {
    if (this.localObjectUrl) {
      URL.revokeObjectURL(this.localObjectUrl);
      this.localObjectUrl = null;
    }
  }

  private maybeStartPendingHostShare(): void {
    if (!this.IsHost || !this.localVideoRef || !this.pendingHostFile || this.captureStarted) {
      return;
    }

    const file = this.pendingHostFile;
    this.pendingHostFile = null;
    this.webrtcService.clearPendingFileShareFile();
    this.initiateHostShare(file);
  }

  private resetHostPickerState(videoEl: HTMLVideoElement): void {
    this.captureStarted = false;
    this.isLoading = false;
    this.isStopping = false;
    videoEl.pause();
    videoEl.removeAttribute('src');
    videoEl.load();
    this.revokeObjectUrl();
    // loadError is intentionally NOT cleared here so the message stays visible
    // until the user picks a new file.
  }
}