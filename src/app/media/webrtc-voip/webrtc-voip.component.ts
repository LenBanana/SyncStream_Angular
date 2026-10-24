import {Component, Input, OnDestroy, OnInit} from '@angular/core';
import {Observable, Subscription} from 'rxjs';
import {skip} from 'rxjs/operators';
import {VideoSource, VoipParticipant, WebrtcVoipService} from './webrtc-voip-service/webrtc-voip.service';
import {SfuLinkState} from '../webrtc/sfu/sfu-transports';
import {getRandomColor} from '../../global.settings';
import {BrowserSettings, changeSettings, loadBrowserSettings, WebRtcSettings} from '../../Interfaces/BrowserSettings';
import {DreckchatService} from '../../dreckchat/dreckchat-service/dreckchat.service';
import {Resolution} from '../webrtc/webrtc-service/webrtc.service';
import {UserPrivileges} from '../../user-admin-modal/user-admin-modal.component';
import {DialogService} from '../../text-dialog/text-dialog-service/dialog-service.service';
import {AlertType} from '../../Interfaces/Dialog';

declare var $: any;

/** The call window. The call itself lives in WebrtcVoipService and carries on while this is not shown. */
@Component({
  selector: 'app-webrtc-voip',
  templateUrl: './webrtc-voip.component.html',
  styleUrls: ['./webrtc-voip.component.scss']
})
export class WebrtcVoipComponent implements OnInit, OnDestroy {
  @Input() Username: string;
  @Input() UniqueId: string;
  @Input() Privileges: UserPrivileges;
  @Input() logout: boolean;
  remoteParticipants: VoipParticipant[] = [];
  localParticipant: VoipParticipant | null = null;
  audioDevices: MediaDeviceInfo[] = [];
  videoDevices: MediaDeviceInfo[] = [];
  videoSettings: WebRtcSettings = new WebRtcSettings();
  previousVideoSettings: WebRtcSettings;
  resolutions = Object.keys(Resolution).filter(key => isNaN(Number(key)));
  browserSettings: BrowserSettings;

  private subscriptions: Subscription[] = [];

  constructor(private voipService: WebrtcVoipService,
              private chatService: DreckchatService,
              private dialogService: DialogService) {
  }

  ngOnInit(): void {
    this.browserSettings = loadBrowserSettings();
    if (this.browserSettings?.webRtcSettings) {
      this.videoSettings = {...this.videoSettings, ...this.browserSettings.webRtcSettings};
    }
    this.subscriptions.push(
      this.voipService.local.subscribe(local => this.localParticipant = local),
      this.voipService.participants.subscribe(participants => this.remoteParticipants = participants),
      this.chatService.openChat.pipe(skip(1)).subscribe(roomId => {
        if (roomId === this.UniqueId) {
          $('#videoCallModal').modal('show');
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  async openSettings(): Promise<void> {
    if (this.audioDevices.length === 0 && this.videoDevices.length === 0) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.audioDevices = devices.filter(device => device.kind === 'audioinput');
      this.videoDevices = devices.filter(device => device.kind === 'videoinput');
      if (this.audioDevices.length > 0 && !this.videoSettings.microphoneId) {
        this.videoSettings.microphoneId = this.audioDevices[0].deviceId;
      }
      if (this.videoDevices.length > 0 && !this.videoSettings.cameraId) {
        this.videoSettings.cameraId = this.videoDevices[0].deviceId;
      }
    }
    this.previousVideoSettings = {...this.videoSettings};
    $('#webRtcVideoSettingsModal').modal({backdrop: 'static', keyboard: false}, 'show');
  }

  async saveSettings(): Promise<void> {
    this.browserSettings.webRtcSettings = this.videoSettings;
    changeSettings(this.browserSettings);
    try {
      if (this.videoSettings.microphoneId !== this.previousVideoSettings.microphoneId) {
        await this.voipService.switchMicrophone();
      }
      if (this.videoSettings.cameraId !== this.previousVideoSettings.cameraId) {
        await this.voipService.switchCamera();
      }
    } catch (err) {
      this.reportFailure('Could not switch device', err);
    }
    $('#webRtcVideoSettingsModal').modal('hide');
  }

  cancelSettings(): void {
    this.videoSettings = this.previousVideoSettings;
    $('#webRtcVideoSettingsModal').modal('hide');
  }

  /** The call's connection state, for the reconnecting badge. */
  get voipState(): Observable<SfuLinkState | null> {
    return this.voipService.callState;
  }

  hasVideo(participant: VoipParticipant | null): boolean {
    return !!participant?.stream && participant.stream.getVideoTracks().length > 0;
  }

  trackParticipant(_index: number, participant: VoipParticipant): string {
    return participant.participantId;
  }

  togglePeerMute(participant: VoipParticipant): void {
    this.voipService.setParticipantMuted(participant.participantId, !participant.isLocallyMuted);
  }

  async toggleAudio(): Promise<void> {
    if (!this.localParticipant) return;
    await this.voipService.setMuted(!this.localParticipant.isMuted);
  }

  async toggleVideo(source: VideoSource): Promise<void> {
    const local = this.localParticipant;
    if (!local) return;
    const showing = source === 'webcam' ? !local.isVideoMuted : !local.isScreenMuted;
    try {
      await this.voipService.setVideo(showing ? null : source);
    } catch (err) {
      this.reportFailure(source === 'webcam' ? 'Could not turn on the camera' : 'Could not share the screen', err);
    }
  }

  async leaveCall(): Promise<void> {
    await this.voipService.leave();
  }

  popOutVideo(parent: HTMLElement, videoElement: HTMLVideoElement): void {
    const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
    if (isFirefox) {
      const initialWidth = Math.floor(window.screen.width * 0.25);
      const initialHeight = Math.floor((initialWidth * 9) / 16);
      const popOutWindow = window.open('', 'Pop Out Video', `width=${initialWidth},height=${initialHeight}`);
      if (!popOutWindow) return;
      popOutWindow.document.body.appendChild(videoElement);
      videoElement.style.width = '100%';
      videoElement.style.height = '100%';
      popOutWindow.document.body.style.margin = '0';
      popOutWindow.document.body.style.padding = '0';
      popOutWindow.document.body.style.backgroundColor = '#222222';
      videoElement.play().catch(err => console.warn('[VoIP] popped-out video could not play', err));
      popOutWindow.addEventListener('unload', () => {
        parent.appendChild(videoElement);
        videoElement.style.width = '';
        videoElement.style.height = '';
      });
      return;
    }
    const pip: Promise<unknown> = document.pictureInPictureElement === videoElement
      ? document.exitPictureInPicture()
      : videoElement.requestPictureInPicture();
    pip.catch(err => console.warn('[VoIP] picture-in-picture refused', err));
  }

  private reportFailure(header: string, err: unknown): void {
    this.dialogService.PushDefaultDialog(err instanceof Error ? err.message : String(err), header, AlertType.Danger);
  }

  protected readonly getRandomColor = getRandomColor;
  protected readonly Resolution = Resolution;
}
