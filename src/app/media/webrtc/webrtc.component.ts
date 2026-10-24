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
import {SfuLinkState} from './sfu/sfu-transports';
import {StreamStartConfig} from './stream-start-dialog/stream-start-dialog.component';
import {BrowserSettings, loadBrowserSettings} from '../../Interfaces/BrowserSettings';
import {baseUrl} from '../../services/signal-r.service';
import {DialogService} from '../../text-dialog/text-dialog-service/dialog-service.service';
import {AlertType} from '../../Interfaces/Dialog';

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
  /** The stage connection could not be restored; the viewer can retry. */
  connectionFailed: boolean = false;
  /** The stage connection dropped and is being restored. */
  reconnecting: boolean = false;
  /** This client's own broadcast is reconnecting to the media server. */
  broadcastReconnecting: boolean = false;
  recordingInfo: SfuRecordingInfo | null = null;
  isRecording: boolean = false;
  /** Where the last recording of this client's broadcast can be downloaded. */
  savedRecordingUrl: string | null = null;
  isBroadcasting: boolean = false;
  showLocalPreview: boolean = true;

  /** Controls visibility of the stream-start dialog. */
  showStreamDialog: boolean = false;
  browserSettings: BrowserSettings = loadBrowserSettings();

  private subscriptions: Subscription[] = [];
  private localPreviewVideoRef: ElementRef<HTMLVideoElement> | undefined;
  private localPreviewStream: MediaStream | null = null;

  constructor(public webrtcService: WebrtcService, private dialogService: DialogService) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.webrtcService.remoteStream
        .pipe(filter(s => s !== null || this.hasStream))
        .subscribe(stream => {
          if (stream) {
            this.hasStream = true;
            this.isLoading = false;
            void this.attachStream(stream);
          } else {
            this.hasStream = false;
            this.detachStream();
          }
        }),
      this.webrtcService.stageState.subscribe(state => this.applyStageState(state)),
      this.webrtcService.localState.subscribe(state => this.broadcastReconnecting = state === 'reconnecting'),
      this.webrtcService.sfuRecording.subscribe(info => {
        this.recordingInfo = info;
        this.isRecording = info !== null;
      }),
      this.webrtcService.recordingSaved.subscribe(filename => {
        // Only the broadcaster made the recording; only they are offered it.
        if (this.isBroadcasting) {
          this.savedRecordingUrl = `${baseUrl}api/recordings/${encodeURIComponent(filename)}`;
        }
      }),
      this.webrtcService.roomStageBroadcastActive.subscribe(active => {
        this.isBroadcasting = active;
        if (active) this.isLoading = false;
      }),
      this.webrtcService.roomStagePreviewStream.subscribe(stream => {
        this.localPreviewStream = stream;
        if (stream) this.isLoading = false;
        this.syncLocalPreview();
      })
    );
  }

  ngAfterViewInit(): void {
    // If a stream arrived before the view was ready, attach it now.
    const current = this.webrtcService.remoteStream.value;
    if (current) {
      this.hasStream = true;
      this.isLoading = false;
      void this.attachStream(current);
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
    this.detachStream();
    this.clearLocalPreview();
  }

  get isShowingLocalPreview(): boolean {
    return this.isBroadcasting && !this.hasStream && this.showLocalPreview && !!this.localPreviewStream;
  }

  get isPreviewHiddenState(): boolean {
    return this.isBroadcasting && !this.hasStream && !this.showLocalPreview && !!this.localPreviewStream;
  }

  private applyStageState(state: SfuLinkState | null): void {
    this.reconnecting = state === 'reconnecting';
    this.connectionFailed = state === 'failed';
  }

  private async attachStream(stream: MediaStream): Promise<void> {
    if (!this.remoteVideoRef) return;
    const video = this.remoteVideoRef.nativeElement;
    if (video.srcObject !== stream) video.srcObject = stream;
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

  /** Opens the stream-start dialog. */
  openStreamDialog(): void {
    this.browserSettings = loadBrowserSettings();
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
      config.capture.release();
      return;
    }
    try {
      this.showLocalPreview = true;
      this.savedRecordingUrl = null;
      this.isLoading = false;
      await this.webrtcService.startStreamingToRoom(this.UniqueId, config.capture);
    } catch (err) {
      config.capture.release();
      this.isLoading = true;
      this.dialogService.PushDefaultDialog(err instanceof Error ? err.message : String(err),
        'Could not broadcast', AlertType.Danger);
    }
  }

  /** Broadcast this client's screen or camera to the room. */
  startBroadcast(): void {
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

  /** Rebuild the connection to the stage after it failed. */
  retryConnection(): void {
    void this.webrtcService.retryStage();
  }

  /** Toggle fullscreen on the video element. */
  toggleFullscreen(): void {
    const video = this.remoteVideoRef?.nativeElement;
    if (!video) return;
    const request = document.fullscreenElement ? document.exitFullscreen() : video.requestFullscreen();
    request.catch(err => console.warn('[WebRTC] fullscreen change refused', err));
  }

  /** Record this client's broadcast on the server. */
  async startRecording(): Promise<void> {
    if (!this.UniqueId) return;
    this.savedRecordingUrl = null;
    await this.webrtcService.startRecording(this.UniqueId);
  }

  async stopRecording(): Promise<void> {
    if (this.UniqueId) {
      await this.webrtcService.stopRecording(this.UniqueId);
    }
  }

  dismissSavedRecording(): void {
    this.savedRecordingUrl = null;
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
    // Muted playback is always allowed to autoplay; a refusal here means the element went away mid-call.
    video.play().catch(err => console.warn('[WebRTC] local preview could not play', err));
  }

  private clearLocalPreview(): void {
    const video = this.localPreviewVideoRef?.nativeElement;
    if (!video) return;
    video.pause();
    video.srcObject = null;
  }
}
