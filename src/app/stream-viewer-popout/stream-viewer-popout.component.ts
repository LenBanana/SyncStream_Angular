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
  @ViewChild('popoutVideo', {static: false}) videoRef: ElementRef<HTMLVideoElement>;

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

  private watchSub  : Subscription;
  private streamSub : Subscription;
  // Stable reference so add/removeEventListener match.
  private readonly pipLeaveHandler = () => {
    this.pipActive = false;
    this.webrtcService.pipActive.next(false);
  };

  constructor(public webrtcService: WebrtcService) {}

  ngOnInit(): void {
    this.pipSupported = !!(document as any).pictureInPictureEnabled;
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
      }
    });

    this.streamSub = this.webrtcService.popoutStream.subscribe(stream => {
      setTimeout(() => {
        const video = this.videoRef?.nativeElement;
        if (!video) return;
        if (stream) {
          video.srcObject = stream;
          video.play().catch(() => {});
        } else {
          video.srcObject = null;
        }
      }, 0);
    });
  }

  ngOnDestroy(): void {
    this.watchSub?.unsubscribe();
    this.streamSub?.unsubscribe();
    this.videoRef?.nativeElement?.removeEventListener('leavepictureinpicture', this.pipLeaveHandler);
  }

  close(): void {
    this.webrtcService.stopWatching();
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
