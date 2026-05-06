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
  /** Viewer: stream is buffering / not yet arrived. */
  isPaused: boolean = false;
  hasRemoteStream: boolean = false;
  isStopping: boolean = false;

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
          })
      );
    }

    // Viewer: attach the SFU stream once it arrives.
    if (!this.IsHost) {
      this.subs.push(
        this.webrtcService.remoteStream
          .subscribe(stream => {
            if (stream) {
              this.hasRemoteStream = true;
              this.attachRemoteStream(stream);
              return;
            }

            this.hasRemoteStream = false;
            this.detachRemoteStream();
          })
      );
    }
  }

  ngAfterViewInit(): void {
    if (this.IsHost) {
      this.maybeStartPendingHostShare();
      return;
    }

    // Viewer: if the stream already arrived before this component rendered, attach it.
    const stream = this.webrtcService.remoteStream.value;
    if (stream) {
      this.hasRemoteStream = true;
      this.attachRemoteStream(stream);
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    if (this.IsHost) {
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

    if (pixels >= 3840 * 2160) return 20_000_000;
    if (pixels >= 2560 * 1440) return 12_000_000;
    if (pixels >= 1920 * 1080) return 8_000_000;
    if (pixels >= 1280 * 720) return 4_500_000;
    return 2_500_000;
  }

  private async initiateHostShare(file: File): Promise<void> {
    if (this.captureStarted) return;
    this.captureStarted = true;
    this.isLoading = true;

    const videoEl = this.localVideoRef.nativeElement;
    this.localObjectUrl = URL.createObjectURL(file);
    videoEl.src = this.localObjectUrl;
    videoEl.muted = false;

    // Wait until the browser has decoded enough to render the first frame.
    const loadOk = await new Promise<boolean>(resolve => {
      const onCanPlay = () => {
        videoEl.removeEventListener('canplay', onCanPlay);
        videoEl.removeEventListener('error', onError);
        resolve(true);
      };
      const onError = () => {
        videoEl.removeEventListener('canplay', onCanPlay);
        videoEl.removeEventListener('error', onError);
        resolve(false);
      };
      videoEl.addEventListener('canplay', onCanPlay, {once: true});
      videoEl.addEventListener('error', onError, {once: true});
      videoEl.load();
    });

    if (!loadOk) {
      console.error('FileSharePlayer: file failed to load.');
      this.resetHostPickerState(videoEl);
      return;
    }

    // captureStream() attaches a live pipe to whatever the video element renders.
    // Pause/seek/ended are all automatically reflected in the WebRTC stream.
    const captureStream: MediaStream | undefined =
      (videoEl as any).captureStream?.(60) ?? (videoEl as any).mozCaptureStream?.(60);

    if (!captureStream) {
      console.error('FileSharePlayer: captureStream() is not supported in this browser.');
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

  /** Stop sharing — called by the Stop button or when the video ends. */
  async stopSharing(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;
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

  private attachRemoteStream(stream: MediaStream): void {
    if (!this.remoteVideoRef) return;
    const video = this.remoteVideoRef.nativeElement;
    video.srcObject = stream;
    video.play().catch(() => {});
  }

  private detachRemoteStream(): void {
    if (!this.remoteVideoRef) return;
    const video = this.remoteVideoRef.nativeElement;
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
  }
}