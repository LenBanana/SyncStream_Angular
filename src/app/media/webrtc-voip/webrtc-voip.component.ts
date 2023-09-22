import {Component, Input, OnDestroy, OnInit} from '@angular/core';
import {VoipParticipant, WebrtcVoipService} from "./webrtc-voip-service/webrtc-voip.service";
import {Subscription} from "rxjs";
import {voipJoinAudio, voipLeaveAudio} from "../../Interfaces/Sounds";
import {getRandomColor} from "../../global.settings";
import {browserSettingName, BrowserSettings, changeSettings, WebRtcSettings} from "../../Interfaces/BrowserSettings";
import {RoomService} from "../../rooms/rooms-service/rooms.service";
import {DreckchatService} from "../../dreckchat/dreckchat-service/dreckchat.service";
import {MediaDeviceService} from "../webrtc/media-device-modal/media-device-service/media-device.service";
import {Resolution} from "../webrtc/webrtc-service/webrtc.service";

declare var $: any;

@Component({
  selector: 'app-webrtc-voip',
  templateUrl: './webrtc-voip.component.html',
  styleUrls: ['./webrtc-voip.component.scss']
})
export class WebrtcVoipComponent implements OnInit, OnDestroy {
  @Input() Username: string;
  @Input() UniqueId: string;
  isInRoom: boolean = false;
  localStream: MediaStream;
  remoteStreams: Map<string, MediaStream> = new Map();
  remoteParticipants: VoipParticipant[] = [];
  localParticipant: VoipParticipant;
  audioDevices: MediaDeviceInfo[] = [];
  videoDevices: MediaDeviceInfo[] = [];
  shareVideo: boolean = false;
  videoSettings: WebRtcSettings = {
    shareScreen: true,
    shareMicrophone: false,
    maxVideoBitrate: 300000, // 300 kbps
    idealResolution: Resolution.FHD,
    idealFrameRate: 60,
    playerWidth: window.screen.width,
    microphoneId: null,
    cameraId: null,
    microphoneVolume: 100
  };
  previousVideoSettings: WebRtcSettings;
  resolutions = Object.keys(Resolution).filter(key => isNaN(Number(key)));

  constructor(private voipService: WebrtcVoipService,
              private roomService: RoomService,
              private chatService: DreckchatService,
              private mediaDeviceService: MediaDeviceService) {
  }

  private subscriptions: Subscription[] = [];

  browserSettings: BrowserSettings;

  fetchSettings() {
    const itemBackup = localStorage.getItem(browserSettingName);
    this.browserSettings = JSON.parse(itemBackup) as BrowserSettings;
  }

  async enumerateDevices() {
    try {
      //const permissions = await navigator.mediaDevices.getUserMedia({audio: true, video: true});
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.audioDevices = devices.filter(device => device.kind === 'audioinput');
      this.videoDevices = devices.filter(device => device.kind === 'videoinput');
    } catch (err) {
      console.log('Error fetching devices: ', err);
    }
  }

  async openSettings() {
    this.previousVideoSettings = JSON.parse(JSON.stringify(this.videoSettings));
    $('#webRtcVideoSettingsModal').modal({backdrop: 'static', keyboard: false}, 'show');
  }

  saveSettings() {
    $('#webRtcVideoSettingsModal').modal('hide');
    this.browserSettings.webRtcSettings = this.videoSettings;
    changeSettings(this.browserSettings)
  }

  cancelSettings() {
    this.videoSettings = this.previousVideoSettings;
    $('#webRtcVideoSettingsModal').modal('hide');
  }

  hasVideoTrack(stream: MediaStream): boolean {
    return stream && stream.getVideoTracks().length > 0;
  }

  ngOnInit(): void {
    this.fetchSettings();
    this.enumerateDevices().then(() => {
      if (this.audioDevices.length > 0) {
        this.videoSettings.microphoneId = this.audioDevices[0].deviceId;
      }
      if (this.videoDevices.length > 0) {
        this.videoSettings.cameraId = this.videoDevices[0].deviceId;
      }
    });
    this.subscriptions.push(
      this.voipService.onNewParticipant.subscribe(async e => {
        if (!e) {
          return;
        }
        await this.handleNewParticipant(e);
      }),
      this.voipService.onParticipantLeave.subscribe(async (participant) => {
        if (!participant) {
          return;
        }
        await this.handleParticipantLeave(participant.participantId);
      }),
      this.voipService.peerMuteStatus.subscribe(async (participant) => {
        if (!participant) {
          return;
        }
        const remoteParticipant = this.remoteParticipants.find(p => p.participantId === participant.participantId);
        if (remoteParticipant) {
          remoteParticipant.isMuted = participant.isMuted;
        }
      }),
      this.roomService.LeaveRoom.subscribe(async (roomId: string) => {
        if (!roomId) {
          return;
        }
        await this.leaveRoom();
      }),
      this.chatService.joinVoice.subscribe(async (roomId: string) => {
        if (!roomId) {
          return;
        }
        if (roomId === this.UniqueId && !this.isInRoom) {
          await this.joinRoom();
        } else {
          await this.leaveRoom();
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    if (this.isInRoom) {
      this.leaveRoom().then(r => this.isInRoom = false);
    }
    this.voipService.cleanUp();
  }

  async joinRoom() {
    $('#deviceModal').modal('show');
  }

  async toggleAudio() {
    const isMuted = !this.localParticipant.isMuted;
    this.localStream.getAudioTracks().forEach(t => {
      t.enabled = !isMuted;
    });
    this.localParticipant.isMuted = isMuted;
    await this.voipService.sendStatus(this.localParticipant, this.UniqueId);
  }

  popOutVideo(parent: HTMLElement, videoElement: HTMLVideoElement) {
    this.voipService.popOutVideo(videoElement, parent);
  }

  async toggleVideo(source: 'webcam' | 'screen') {
    if (this.hasVideoTrack(this.localStream)) {
      await this.voipService.removeVideoTrackFromConnection();
      if ((source === 'webcam' && !this.localParticipant.isVideoMuted) || (source === 'screen' && !this.localParticipant.isScreenMuted)) {
        this.localParticipant.isVideoMuted = true;
        this.localParticipant.isScreenMuted = true;
        return;
      }
    }
    if (source === 'webcam') {
      await this.addWebcamVideo();
      this.localParticipant.isVideoMuted = false;
      this.localParticipant.isScreenMuted = true;
    } else if (source === 'screen') {
      await this.addScreenVideo();
      this.localParticipant.isScreenMuted = false;
      this.localParticipant.isVideoMuted = true;
    }
  }

  async addWebcamVideo() {
    const videoStream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: this.videoSettings.cameraId ? {exact: this.videoSettings.cameraId} : undefined,
        width: {min: 640, ideal: 1280, max: 1920},
        height: {min: 480, ideal: 720, max: 1080},
        frameRate: {min: 10, ideal: 30, max: 60}
      }
    });
    videoStream.getVideoTracks().forEach(t => {
      this.voipService.addVideoTrackToConnection(t);
    });
  }

  async addScreenVideo() {
    if (!this.browserSettings.webRtcSettings) {
      $('#webRtcVideoSettingsModal').modal({backdrop: 'static', keyboard: false}, 'show');
      return;
    }
    const screenStream = await this.mediaDeviceService.getDevice(this.browserSettings.webRtcSettings);
    screenStream.getVideoTracks().forEach(t => {
      this.voipService.addVideoTrackToConnection(t);
    });
  }


  async getMediaStream(constraints) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.localStream = stream;
      return stream;
    } catch (err) {
      console.error("Error accessing media devices.", err);
      throw err;
    }
  }

  async joinAudioRoom(stream) {
    await this.voipService.joinAudioRoom(this.UniqueId, stream);
  }

  async postJoinActions() {
    this.isInRoom = true;
    this.voipService.joinRoom.next(this.UniqueId);
    $('#deviceModal').modal('hide');
    if (this.browserSettings && this.browserSettings.generalSettings.playVoipJoinSound) {
      await voipJoinAudio.play();
    }
  }

  setupAudioAnalysis(participant: VoipParticipant) {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(participant.stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    source.connect(analyser);

    const checkMicActivity = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      participant.isSpeaking = average > 1;
      requestAnimationFrame(checkMicActivity);
    };

    checkMicActivity();
  }

  async joinRoomWithSelectedDevices() {
    const constraints = {
      audio: {
        deviceId: this.videoSettings.microphoneId ? {exact: this.videoSettings.microphoneId} : undefined,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        sampleSize: 16,
        channelCount: 2
      },
      video: this.shareVideo ? {
        deviceId: this.videoSettings.cameraId ? {exact: this.videoSettings.cameraId} : undefined,
        width: {min: 640, ideal: 1280, max: 1920},
        height: {min: 480, ideal: 720, max: 1080},
        frameRate: {min: 10, ideal: 30, max: 60}
      } : false
    };

    try {
      const stream = await this.getMediaStream(constraints);
      await this.joinAudioRoom(stream);
      setTimeout(async () => {
        await this.postJoinActions();
      });
      this.localParticipant = {
        participantId: this.UniqueId,
        stream: stream,
        participantName: this.Username,
        isVideoMuted: !this.hasVideoTrack(stream),
        isScreenMuted: true,
        isMuted: false
      };
      this.setupAudioAnalysis(this.localParticipant);
    } catch (err) {
      console.error("An error occurred:", err);
    }
  }


  async leaveRoom() {
    await this.voipService.leaveAudioRoom(this.UniqueId);
    setTimeout(async () => {
      this.isInRoom = false;
      this.localStream.getTracks().forEach(track => track.stop());
      this.remoteStreams.clear();
      this.remoteParticipants = [];
      this.voipService.leaveRoom.next(this.UniqueId);
      $('#videoCallModal').modal('hide');
      if (this.browserSettings && this.browserSettings.generalSettings.playVoipJoinSound) {
        await voipLeaveAudio.play();
      }
    });
  }

  async handleNewParticipant(participant: VoipParticipant) {
    if (this.remoteStreams.has(participant.participantId)) {
      return;
    }
    this.remoteStreams.set(participant.participantId, participant.stream);
    this.setupAudioAnalysis(participant);
    this.remoteParticipants.push(participant);
    if (this.browserSettings && this.browserSettings.generalSettings.playVoipJoinSound) {
      await voipJoinAudio.play();
    }
  }

  async handleParticipantLeave(participantId: string) {
    this.remoteStreams.delete(participantId);
    this.remoteParticipants = this.remoteParticipants.filter(p => p.participantId !== participantId);
    if (this.browserSettings && this.browserSettings.generalSettings.playVoipJoinSound) {
      await voipLeaveAudio.play();
    }
  }

  protected readonly getRandomColor = getRandomColor;
  protected readonly Resolution = Resolution;
}
