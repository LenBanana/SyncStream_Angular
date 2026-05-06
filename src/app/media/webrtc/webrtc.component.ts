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
import {BrowserSettings, browserSettingName} from '../../Interfaces/BrowserSettings';

@Component({
  selector: 'app-webrtc',
  templateUrl: './webrtc.component.html',
  styleUrls: ['./webrtc.component.scss']
})
export class WebrtcComponent implements OnInit, OnDestroy, AfterViewInit {
  @Input() UniqueId: string = '';
  @Input() IsHost: boolean = false;

  @ViewChild('remoteVideo') remoteVideoRef!: ElementRef<HTMLVideoElement>;

  hasStream: boolean = false;
  isLoading: boolean = true;
  connectionFailed: boolean = false;
  recordingInfo: SfuRecordingInfo | null = null;
  isRecording: boolean = false;
  isBroadcasting: boolean = false;

  /** Controls visibility of the stream-start dialog. */
  showStreamDialog: boolean = false;
  browserSettings: BrowserSettings = this._loadSettings();

  private sub: Subscription | null = null;
  private recordingSub: Subscription | null = null;

  constructor(public webrtcService: WebrtcService) {}

  private _loadSettings(): BrowserSettings {
    try {
      const raw = localStorage.getItem(browserSettingName);
      return raw ? JSON.parse(raw) as BrowserSettings : new BrowserSettings();
    } catch {
      return new BrowserSettings();
    }
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
    this.detachStream();
  }

  private attachStream(stream: MediaStream): void {
    if (!this.remoteVideoRef) return;
    const video = this.remoteVideoRef.nativeElement;
    video.srcObject = stream;
    video.play().catch(() => {
      // Autoplay may be blocked; the user can click Play.
    });
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
      // Stop broadcasting if the user ends the capture via the browser's built-in stop button.
      config.stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (this.isBroadcasting) this.stopBroadcast();
      });
      await this.webrtcService.broadcastToRoom(this.UniqueId, config.stream, config.maxBitrate);
      this.isBroadcasting = true;
    } catch (err) {
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
    await this.webrtcService.stopBroadcast(this.UniqueId);
    this.isBroadcasting = false;
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
}
