import {
  Component, OnInit, OnDestroy, ViewChild, ElementRef, Input, HostListener
} from '@angular/core';
import { Subscription } from 'rxjs';
import { WebrtcService } from '../media/webrtc/webrtc-service/webrtc.service';

const STORAGE_KEY = 'dreck-popout-state';
const MIN_WIDTH    = 280;
const MIN_HEIGHT   = 180;

@Component({
  selector: 'app-stream-viewer-popout',
  templateUrl: './stream-viewer-popout.component.html',
  styleUrls: ['./stream-viewer-popout.component.scss']
})
export class StreamViewerPopoutComponent implements OnInit, OnDestroy {

  @Input() RoomId: string;
  @ViewChild('popoutVideo', {static: false})
  set popoutVideoRef(value: ElementRef<HTMLVideoElement> | undefined) {
    this.unbindVideoElementEvents();
    this.videoRef = value;
    this.bindVideoElementEvents();
    this.syncVideoElement();
  }

  // ---- Visibility ----
  visible      = false;
  minimized    = false;
  streamerName = '';

  // ---- Position / size ----
  posX         = 20;
  posY         = 20;
  popoutWidth  = 420;
  popoutHeight = 272; // ~32px titlebar + 240px video

  // ---- Drag ----
  dragging    = false;
  dragOffsetX = 0;
  dragOffsetY = 0;

  // ---- Resize ----
  resizing          = false;
  resizeStartX      = 0;
  resizeStartY      = 0;
  resizeStartWidth  = 0;
  resizeStartHeight = 0;

  // ---- Picture-in-Picture ----
  pipSupported = false;
  pipActive    = false;
  playbackActivationRequired = false;
  playbackStartedMuted = false;
  hasAudioTrack = false;
  hasVideoTrack = false;

  private videoRef: ElementRef<HTMLVideoElement> | undefined;
  private watchSub  : Subscription;
  private streamSub : Subscription;
  private currentStream: MediaStream | null = null;
  private readonly videoLoadedMetadataHandler = () => {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    console.debug('[WebRTC popout] video loadedmetadata', this.describeVideoElement(video));
    if (this.currentStream && video.paused) {
      const trackSummary = this.currentStream.getTracks().map(track => `${track.kind}:${track.readyState}`).join(', ');
      void this.tryStartPlayback(video, trackSummary || 'no-tracks');
    }
  };
  private readonly videoCanPlayHandler = () => {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    console.debug('[WebRTC popout] video canplay', this.describeVideoElement(video));
  };
  private readonly videoPlayingHandler = () => {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    console.debug('[WebRTC popout] video playing', this.describeVideoElement(video));
  };
  private readonly videoPauseHandler = () => {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    console.debug('[WebRTC popout] video pause', this.describeVideoElement(video));
  };
  private readonly videoWaitingHandler = () => {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    console.debug('[WebRTC popout] video waiting', this.describeVideoElement(video));
  };
  private readonly videoStalledHandler = () => {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    console.debug('[WebRTC popout] video stalled', this.describeVideoElement(video));
  };
  private readonly videoErrorHandler = () => {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    console.warn('[WebRTC popout] video error', {
      element: this.describeVideoElement(video),
      error: video.error ? {
        code: video.error.code,
        message: (video.error as MediaError & {message?: string}).message ?? null
      } : null
    });
  };
  // Stable reference so add/removeEventListener match.
  private readonly pipLeaveHandler = () => {
    this.pipActive = false;
    this.webrtcService.pipActive.next(false);
  };

  constructor(public webrtcService: WebrtcService) {}

  ngOnInit(): void {
    // Firefox < 116 does not expose document.pictureInPictureEnabled but does
    // implement video.requestPictureInPicture() since Firefox 71.  Check both.
    this.pipSupported = !!(document as any).pictureInPictureEnabled ||
      typeof (HTMLVideoElement.prototype as any).requestPictureInPicture === 'function';
    this.loadState();

    this.watchSub = this.webrtcService.watchRequest.subscribe(req => {
      if (req) {
        this.streamerName = req.username || 'Streamer';
        this.visible   = true;
        this.minimized = false;
      } else {
        this.exitPipIfActive();
        this.visible      = false;
        this.streamerName = '';
        this.resetPlaybackState();
      }
    });

    this.streamSub = this.webrtcService.popoutStream.subscribe(stream => {
      this.currentStream = stream;
      this.syncVideoElement();
    });
  }

  ngOnDestroy(): void {
    this.watchSub?.unsubscribe();
    this.streamSub?.unsubscribe();
    this.unbindVideoElementEvents();
    this.videoRef?.nativeElement?.removeEventListener('leavepictureinpicture', this.pipLeaveHandler);
  }

  close(): void {
    this.webrtcService.stopWatching();
  }

  async resumePlaybackWithAudio(): Promise<void> {
    const video = this.videoRef?.nativeElement;
    if (!video) return;

    try {
      video.muted = false;
      await video.play();
      this.playbackActivationRequired = false;
      this.playbackStartedMuted = false;
      console.debug('[WebRTC popout] playback resumed with audio');
    } catch (err) {
      console.warn('[WebRTC popout] manual playback resume failed', err);
      this.playbackActivationRequired = true;
    }
  }

  toggleMinimize(): void {
    this.minimized = !this.minimized;
  }

  // ---- Picture-in-Picture ----

  async togglePip(): Promise<void> {
    const video = this.videoRef?.nativeElement;
    if (!video) return;
    try {
      if ((document as any).pictureInPictureElement) {
        await (document as any).exitPictureInPicture();
        // pipActive is reset by the leavepictureinpicture handler.
      } else {
        video.addEventListener('leavepictureinpicture', this.pipLeaveHandler);
        await (video as any).requestPictureInPicture();
        this.pipActive = true;
        this.webrtcService.pipActive.next(true);
      }
    } catch (err) {
      console.warn('PiP error:', err);
    }
  }

  private exitPipIfActive(): void {
    if ((document as any).pictureInPictureElement) {
      (document as any).exitPictureInPicture().catch(() => {});
    }
    this.pipActive = false;
    this.webrtcService.pipActive.next(false);
  }

  private syncVideoElement(): void {
    const video = this.videoRef?.nativeElement;
    if (!video) {
      if (this.currentStream) {
        const trackSummary = this.currentStream.getTracks().map(track => `${track.kind}:${track.readyState}`).join(', ');
        console.debug('[WebRTC popout] stream ready before video element mounted', trackSummary || 'no-tracks');
      }
      return;
    }

    if (this.currentStream) {
      const nextStream = this.currentStream;
      this.hasAudioTrack = nextStream.getAudioTracks().length > 0;
      this.hasVideoTrack = nextStream.getVideoTracks().length > 0;
      if (video.srcObject !== nextStream) {
        video.srcObject = nextStream;
        console.debug('[WebRTC popout] assigned srcObject', {
          streamId: nextStream.id,
          tracks: nextStream.getTracks().map(track => ({
            kind: track.kind,
            id: track.id,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState
          }))
        });
      }

      const trackSummary = nextStream.getTracks().map(track => `${track.kind}:${track.readyState}`).join(', ');
      video.controls = this.hasAudioTrack || this.playbackActivationRequired;
      void this.tryStartPlayback(video, trackSummary || 'no-tracks');
      return;
    }

    if (video.srcObject) {
      video.pause();
      video.srcObject = null;
    }
    this.resetPlaybackState();
  }

  private async tryStartPlayback(video: HTMLVideoElement, trackSummary: string): Promise<void> {
    try {
      video.muted = false;
      await video.play();
      this.playbackActivationRequired = false;
      this.playbackStartedMuted = false;
      return;
    } catch (err) {
      console.warn('[WebRTC popout] video.play() failed; trying muted autoplay fallback', {
        error: err,
        tracks: trackSummary
      });
    }

    if (!this.hasAudioTrack) {
      this.playbackActivationRequired = true;
      this.playbackStartedMuted = false;
      return;
    }

    try {
      video.muted = true;
      await video.play();
      this.playbackActivationRequired = true;
      this.playbackStartedMuted = true;
      console.debug('[WebRTC popout] muted autoplay fallback succeeded', trackSummary);
    } catch (err) {
      console.warn('[WebRTC popout] muted autoplay fallback failed', {error: err, tracks: trackSummary});
      this.playbackActivationRequired = true;
      this.playbackStartedMuted = false;
    }
  }

  private resetPlaybackState(): void {
    this.playbackActivationRequired = false;
    this.playbackStartedMuted = false;
    this.hasAudioTrack = false;
    this.hasVideoTrack = false;
  }

  private bindVideoElementEvents(): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;

    video.addEventListener('loadedmetadata', this.videoLoadedMetadataHandler);
    video.addEventListener('canplay', this.videoCanPlayHandler);
    video.addEventListener('playing', this.videoPlayingHandler);
    video.addEventListener('pause', this.videoPauseHandler);
    video.addEventListener('waiting', this.videoWaitingHandler);
    video.addEventListener('stalled', this.videoStalledHandler);
    video.addEventListener('error', this.videoErrorHandler);
  }

  private unbindVideoElementEvents(): void {
    const video = this.videoRef?.nativeElement;
    if (!video) return;

    video.removeEventListener('loadedmetadata', this.videoLoadedMetadataHandler);
    video.removeEventListener('canplay', this.videoCanPlayHandler);
    video.removeEventListener('playing', this.videoPlayingHandler);
    video.removeEventListener('pause', this.videoPauseHandler);
    video.removeEventListener('waiting', this.videoWaitingHandler);
    video.removeEventListener('stalled', this.videoStalledHandler);
    video.removeEventListener('error', this.videoErrorHandler);
  }

  private describeVideoElement(video: HTMLVideoElement): Record<string, unknown> {
    return {
      readyState: video.readyState,
      networkState: video.networkState,
      paused: video.paused,
      muted: video.muted,
      autoplay: video.autoplay,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      currentTime: video.currentTime,
      hasSrcObject: !!video.srcObject
    };
  }

  // ---- Drag ----

  onDragStart(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('button, .resize-handle')) return;
    this.dragging    = true;
    this.dragOffsetX = event.clientX - this.posX;
    this.dragOffsetY = event.clientY - this.posY;
    event.preventDefault();
  }

  // ---- Resize ----

  onResizeStart(event: MouseEvent): void {
    this.resizing          = true;
    this.resizeStartX      = event.clientX;
    this.resizeStartY      = event.clientY;
    this.resizeStartWidth  = this.popoutWidth;
    this.resizeStartHeight = this.popoutHeight;
    event.preventDefault();
    event.stopPropagation();
  }

  // ---- Shared mouse handlers ----

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (this.dragging) {
      this.posX = Math.max(0, event.clientX - this.dragOffsetX);
      this.posY = Math.max(0, event.clientY - this.dragOffsetY);
    }
    if (this.resizing) {
      this.popoutWidth  = Math.max(MIN_WIDTH,  this.resizeStartWidth  + (event.clientX - this.resizeStartX));
      this.popoutHeight = Math.max(MIN_HEIGHT, this.resizeStartHeight + (event.clientY - this.resizeStartY));
    }
  }

  @HostListener('document:mouseup')
  onMouseUp(): void {
    if (this.dragging || this.resizing) {
      this.saveState();
    }
    this.dragging = false;
    this.resizing = false;
  }

  // ---- Persistence ----

  private loadState(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.posX   === 'number') this.posX        = s.posX;
      if (typeof s.posY   === 'number') this.posY        = s.posY;
      if (typeof s.width  === 'number') this.popoutWidth  = Math.max(MIN_WIDTH,  s.width);
      if (typeof s.height === 'number') this.popoutHeight = Math.max(MIN_HEIGHT, s.height);
    } catch {}
  }

  private saveState(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        posX: this.posX,   posY: this.posY,
        width: this.popoutWidth, height: this.popoutHeight
      }));
    } catch {}
  }
}
