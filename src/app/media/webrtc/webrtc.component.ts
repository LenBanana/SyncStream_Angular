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
import {SfuRecordingInfo, WebrtcService} from './webrtc-service/webrtc.service';
import {token} from '../../global.settings';
import {StreamStartConfig} from './stream-start-dialog/stream-start-dialog.component';
import {BrowserSettings, loadBrowserSettings} from '../../Interfaces/BrowserSettings';

@Component({
  selector: 'app-webrtc',
  templateUrl: './webrtc.component.html',
  styleUrls: ['./webrtc.component.scss']
})
export class WebrtcComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() UniqueId: string = '';
  @Input() IsHost: boolean = false;

  @ViewChild('remoteVideo') remoteVideoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('localPreviewVideo')
  set localPreviewVideoElement(value: ElementRef<HTMLVideoElement> | undefined) {
    this.localPreviewVideoRef = value;
    this.syncLocalPreview();
  }

  hasStream: boolean = false;
  isLoading: boolean = true;
  connectionFailed: boolean = false;
  recordingInfo: SfuRecordingInfo | null = null;
  isRecording: boolean = false;
  isBroadcasting: boolean = false;
  showLocalPreview: boolean = true;

  /** Controls visibility of the stream-start dialog. */
  showStreamDialog: boolean = false;
  browserSettings: BrowserSettings = this._loadSettings();

  private sub: Subscription | null = null;
  private recordingSub: Subscription | null = null;
  private broadcastStateSub: Subscription | null = null;
  private roomStagePreviewSub: Subscription | null = null;
  private localPreviewVideoRef: ElementRef<HTMLVideoElement> | undefined;
  private localPreviewStream: MediaStream | null = null;

  constructor(public webrtcService: WebrtcService) {}

  private _loadSettings(): BrowserSettings {
    return loadBrowserSettings();
  }

  ngOnInit(): void {
    // Subscribe to the incoming MediaStream from the P2P or SFU path.
    this.sub = this.webrtcService.remoteStream
      .pipe(filter(s => s !== null || this.hasStream))
      .subscribe(stream => {
        if (stream) {
          this.hasStream = true;
          this.isLoading = false;
          this.connectionFailed = false;
          this.attachStream(stream);
        } else {
          this.hasStream = false;
          this.detachStream();
        }
      });

    this.recordingSub = this.webrtcService.sfuRecording.subscribe(info => {
      this.recordingInfo = info;
      this.isRecording = info !== null;
    });

    this.broadcastStateSub = this.webrtcService.roomStageBroadcastActive.subscribe(active => {
      this.isBroadcasting = active;
      if (active) {
        this.isLoading = false;
      }
    });

    this.roomStagePreviewSub = this.webrtcService.roomStagePreviewStream.subscribe(stream => {
      this.localPreviewStream = stream;
      if (stream) {
        this.isLoading = false;
      }
      this.syncLocalPreview();
    });
  }

  ngAfterViewInit(): void {
    // If a stream arrived before the view was ready, attach it now.
    const current = this.webrtcService.remoteStream.value;
    if (current) {
      this.hasStream = true;
      this.isLoading = false;
      this.attachStream(current);
    }
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.recordingSub?.unsubscribe();
    this.broadcastStateSub?.unsubscribe();
    this.roomStagePreviewSub?.unsubscribe();
    this.detachStream();
    this.clearLocalPreview();
  }

  get isShowingLocalPreview(): boolean {
    return this.isBroadcasting && !this.hasStream && this.showLocalPreview && !!this.localPreviewStream;
  }

  get isPreviewHiddenState(): boolean {
    return this.isBroadcasting && !this.hasStream && !this.showLocalPreview && !!this.localPreviewStream;
  }

  private async attachStream(stream: MediaStream): Promise<void> {
    if (!this.remoteVideoRef) return;
    const video = this.remoteVideoRef.nativeElement;
    video.srcObject = stream;
    video.muted = false;

    try {
      await video.play();
      return;
    } catch (err) {
      console.warn('[WebRTC] video.play() failed; trying muted autoplay fallback', err);
    }

    if (stream.getAudioTracks().length === 0) {
      return;
    }

    try {
      video.muted = true;
      await video.play();
    } catch (err) {
      console.warn('[WebRTC] muted autoplay fallback failed', err);
    }
  }

  private detachStream(): void {
    if (!this.remoteVideoRef) return;
    const video = this.remoteVideoRef.nativeElement;
    video.pause();
    video.srcObject = null;
  }

  /** Opens the stream-start dialog (replaces the raw getDisplayMedia call). */
  openStreamDialog(): void {
    this.browserSettings = this._loadSettings();
    this.showStreamDialog = true;
  }

  /** Called when the user cancels the stream dialog. */
  onStreamDialogCancelled(): void {
    this.showStreamDialog = false;
  }

  /** Called when the user confirms in the stream dialog. */
  async onStreamDialogConfirmed(config: StreamStartConfig): Promise<void> {
    this.showStreamDialog = false;
    if (!this.UniqueId) {
      config.stream.getTracks().forEach(t => t.stop());
      return;
    }
    try {
      this.showLocalPreview = true;
      this.isLoading = false;
      // Stop broadcasting if the user ends the capture via the browser's built-in stop button.
      config.stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (this.isBroadcasting) this.stopBroadcast();
      });
      await this.webrtcService.startStreamingToRoom(
        this.UniqueId,
        config.stream,
        config.maxBitrate,
        config.resolution,
        config.frameRate,
        config.contentPreference
      );
    } catch (err) {
      this.isLoading = true;
      console.error('Failed to start broadcast:', err);
    }
  }

  /** Start a forced P2P broadcast to all room members (Moderator+). */
  async startBroadcast(): Promise<void> {
    this.openStreamDialog();
  }

  /** Stop the active broadcast. */
  async stopBroadcast(): Promise<void> {
    if (!this.UniqueId) return;
    await this.webrtcService.stopStreamingToRoom(this.UniqueId);
    this.showLocalPreview = true;
    this.isLoading = true;
  }

  toggleLocalPreview(): void {
    this.showLocalPreview = !this.showLocalPreview;
    this.syncLocalPreview();
  }

  /** Request ICE restart when the P2P connection degrades. */
  requestReconnect(): void {
    if (this.UniqueId) {
      this.webrtcService.requestIceRestart(this.UniqueId);
    }
  }

  /** Toggle fullscreen on the video element. */
  toggleFullscreen(): void {
    const video = this.remoteVideoRef?.nativeElement;
    if (!video) return;
    if (!document.fullscreenElement) {
      video.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  /** Start server-side SFU recording (host only). */
  async startRecording(): Promise<void> {
    if (this.UniqueId) {
      await this.webrtcService.startRecording(this.UniqueId);
    }
  }

  /** Stop server-side SFU recording (host only). */
  async stopRecording(): Promise<void> {
    if (this.UniqueId) {
      await this.webrtcService.stopRecording(this.UniqueId);
    }
  }

  /** Adaptive bitrate: set the highest simulcast layer. */
  setQualityHigh(): void {
    const consumers = this.webrtcService.getSfuConsumerIds();
    consumers.forEach(id => this.webrtcService.setPreferredLayers(this.UniqueId, id, 2, 2));
  }

  /** Adaptive bitrate: set medium simulcast layer. */
  setQualityMedium(): void {
    const consumers = this.webrtcService.getSfuConsumerIds();
    consumers.forEach(id => this.webrtcService.setPreferredLayers(this.UniqueId, id, 1, 2));
  }

  /** Adaptive bitrate: set lowest simulcast layer (saves bandwidth). */
  setQualityLow(): void {
    const consumers = this.webrtcService.getSfuConsumerIds();
    consumers.forEach(id => this.webrtcService.setPreferredLayers(this.UniqueId, id, 0, 2));
  }

  private syncLocalPreview(): void {
    const video = this.localPreviewVideoRef?.nativeElement;
    if (!video) return;

    if (!this.showLocalPreview || !this.localPreviewStream) {
      video.pause();
      video.srcObject = null;
      return;
    }

    if (video.srcObject !== this.localPreviewStream) {
      video.srcObject = this.localPreviewStream;
    }
    video.muted = true;
    video.play().catch(() => {
      // Muted local preview should normally autoplay, but this remains best-effort.
    });
  }

  private clearLocalPreview(): void {
    const video = this.localPreviewVideoRef?.nativeElement;
    if (!video) return;
    video.pause();
    video.srcObject = null;
  }
}
