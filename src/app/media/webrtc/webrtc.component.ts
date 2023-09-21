import {AfterViewInit, Component, ElementRef, Input, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {Subscription} from 'rxjs';
import {Resolution, WebRtcClientOffer, WebrtcService, WebRtcSettings} from './webrtc-service/webrtc.service';
import {PlayerType} from "../../player/player.component";
import {MediaDeviceService} from "./media-device-modal/media-device-service/media-device.service";
import {MediaService} from "../media-service/media.service";

declare var $: any;

declare var adapter: any;

@Component({
  selector: 'app-webrtc',
  templateUrl: './webrtc.component.html',
  styleUrls: ['./webrtc.component.scss']
})
export class WebrtcComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() UniqueId: string;
  @ViewChild('webRtcVideo') webRtcVideo: ElementRef<HTMLVideoElement>;  // Using ViewChild
  settings: WebRtcSettings = {
    shareScreen: true,
    shareMicrophone: false,
    maxVideoBitrate: 300000, // 300 kbps
    idealResolution: Resolution.FHD,
    idealFrameRate: 60
  };
  resolutions = Object.keys(Resolution).filter(key => isNaN(Number(key)));
  subscriptions: Subscription[] = [];
  peerConnections: Map<string, RTCPeerConnection> = new Map();
  peerConnection = new RTCPeerConnection();
  iceCandidateQueue: RTCIceCandidate[] = [];
  ShareScreen: boolean = true;
  ShareMicrophone: boolean = false;
  SharedMediaStream: MediaStream;

  constructor(private webRtcService: WebrtcService,
              private mediaDeviceService: MediaDeviceService,
              private mediaService: MediaService
  ) {
  }

  ngOnInit(): void {
    const storedSettings = localStorage.getItem('webRtcSettings');
    if (storedSettings) {
      this.settings = JSON.parse(storedSettings);
    }
    this.subscriptions.push(this.webRtcService.startStream.subscribe(o => {
      if (o) {
        //this.StartDisplay();
        this.showSettingsModal();
      }
    }));
  }

  showSettingsModal() {
    const video = this.webRtcVideo.nativeElement;
    if (video.srcObject && this.peerConnection.signalingState != "stable") {
      this.stopStreaming();
      video.srcObject = null;
      return;
    }
    $('#webRtcSettingsModal').modal('show');
  }

  cancelSettings() {
    $('#webRtcSettingsModal').modal('hide');
    this.webRtcService.streamStop.next("stop");
  }

  saveChanges() {
    localStorage.setItem('webRtcSettings', JSON.stringify(this.settings));
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
    this.webRtcService.CleanUpWebRtc();
    this.SharedMediaStream = null;
  }

  async createOffer(peerConnection: RTCPeerConnection): Promise<void> {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
  }

  ngAfterViewInit(): void {
    this.subscriptions.push(this.webRtcService.streamStart.subscribe(o => {
      if (o) {
        if (this.peerConnections.size > 0) {
          this.stopStreaming();
        }
        this.webRtcService.JoinWebRtcStream(this.UniqueId);
      }
    }));
    this.subscriptions.push(this.webRtcService.joinStream.subscribe(async o => {
      if (o) {
        await this.createIce(o);
      }
    }));
    this.subscriptions.push(this.webRtcService.streamCandidates.subscribe(async c => {
      if (c && c.candidate) {
        if (c.viewerId) {
          const pc = this.peerConnections.get(c.viewerId);
          if (!pc) return;
          await pc.addIceCandidate(new RTCIceCandidate(c));
          return;
        }
        if (!this.peerConnection.remoteDescription) {
          this.iceCandidateQueue.push(new RTCIceCandidate(c));
        } else {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(c));
        }
      }
    }));
    this.subscriptions.push(this.webRtcService.streamAnswers.subscribe(async a => {
      if (a && a.sdp) {
        const pc = this.peerConnections.get(a.viewerId);
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription({sdp: a.sdp, type: a.type as RTCSdpType}));
      }
    }));
    this.subscriptions.push(this.webRtcService.streamOffer.subscribe(async o => {
      if (o && o.sdp) {
        await this.onReceiveSignal(o);
      }
    }));
    this.subscriptions.push(this.webRtcService.streamStop.subscribe(o => {
      if (o) {
        this.peerConnection.close();
      }
    }));
    if (adapter.browserDetails.browser === 'chrome' &&
      adapter.browserDetails.version >= 107) {
    } else if (adapter.browserDetails.browser === 'firefox') {
      adapter.browserShim.shimGetDisplayMedia(window, 'screen');
    }
  }

  startDisplay() {
    $('#webRtcSettingsModal').modal('hide');
    this.saveChanges();
    this.mediaDeviceService.getDevice(this.settings)
      .then((e) => {
        this.SharedMediaStream = e;
        this.handleSuccess();
      }, (e) => {
        console.log(`getDisplayMedia error: ${e}`)
        this.webRtcService.streamStop.next("stop");
      });
  }

  stopStreaming() {
    this.webRtcService.StopWebRtcStream(this.UniqueId);
    this.peerConnections.forEach((pc) => {
      pc.close();
    });
    const tracks = this.SharedMediaStream?.getTracks();
    for (let i = 0; i < tracks?.length; i++) tracks[i].stop();
    this.peerConnections.clear();
  }

  handleSuccess() {
    if (this.peerConnection.signalingState == "stable") {
      this.peerConnection.close();
    }
    this.webRtcService.StartWebRtcStream(this.UniqueId);
    const video = this.webRtcVideo.nativeElement;
    video.srcObject = this.SharedMediaStream;
    this.SharedMediaStream.getVideoTracks()[0].addEventListener('ended', () => {
      this.stopStreaming();
      video.srcObject = null;
    });
  }

  async createIce(viewerId: string) {
    try {
      const configuration = await this.webRtcService.getWebRtcConfig();
      const peerConnection = new RTCPeerConnection(configuration);
      peerConnection.onconnectionstatechange = (e) => {
        if (peerConnection.connectionState === 'disconnected') {
          peerConnection.close();
          this.peerConnections.delete(viewerId);
        }
      };
      peerConnection.onicecandidate = (c) => {
        if (c.candidate) {
          this.webRtcService.SendIceCandidateToViewer(c.candidate, viewerId);
        }
      };
      this.peerConnections.set(viewerId, peerConnection);
      if (this.SharedMediaStream) {
        this.SharedMediaStream.getTracks().forEach(track => {
          peerConnection.addTrack(track, this.SharedMediaStream);
        });
      }
      const videoSender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (videoSender) {
        const parameters = videoSender.getParameters();
        if (!parameters.encodings) {
          parameters.encodings = [{}];
        }
        parameters.encodings[0].maxBitrate = this.settings.maxVideoBitrate;
        await videoSender.setParameters(parameters);
      }

      const offerOptions: RTCOfferOptions = {offerToReceiveAudio: true, offerToReceiveVideo: true};
      const desc = await peerConnection.createOffer(offerOptions);
      let offer: WebRtcClientOffer = {sdp: desc.sdp, type: desc.type.toString(), viewerId: null};
      await peerConnection.setLocalDescription(desc);
      this.webRtcService.SendOfferToViewer(offer, viewerId);
    } catch (err) {
      console.log(`Error creating offer: ${err}`);
      return;
    }
  }

  async onReceiveSignal(signal: WebRtcClientOffer): Promise<void> {
    if (signal.type === 'answer') {
    } else if (signal.type === 'offer') {
      const configuration = await this.webRtcService.getWebRtcConfig();
      this.peerConnection = new RTCPeerConnection(configuration);
      this.peerConnection.onicecandidate = c => {
        if (c.candidate) {
          this.webRtcService.SendIceCandidate(c.candidate, this.UniqueId);
        }
      };
      this.peerConnection.ontrack = event => {
        const video = this.webRtcVideo.nativeElement;
        video.srcObject = event.streams[0];
      };
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription({type: signal.type, sdp: signal.sdp}));
      for (let candidate of this.iceCandidateQueue) {
        await this.peerConnection.addIceCandidate(candidate);
      }
      this.iceCandidateQueue = [];
      const desc = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(desc);
      let offer: WebRtcClientOffer = {sdp: desc.sdp, type: desc.type.toString(), viewerId: null};
      this.webRtcService.CreateStreamAnswer(offer, this.UniqueId);
    }
  }

  protected readonly PlayerType = PlayerType;
  protected readonly Resolution = Resolution;
}
