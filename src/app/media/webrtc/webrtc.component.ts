import {AfterViewInit, Component, Input, OnDestroy, OnInit} from '@angular/core';
import {BehaviorSubject, Subscription} from 'rxjs';
import {WebRtcClientOffer, WebrtcService} from './webrtc-service/webrtc.service';
import {PlayerType} from "../../player/player.component";
import {MediaDeviceService} from "./media-device-modal/media-device-service/media-device.service";

declare var $: any;

declare var adapter: any;

@Component({
  selector: 'app-webrtc',
  templateUrl: './webrtc.component.html',
  styleUrls: ['./webrtc.component.scss']
})
export class WebrtcComponent implements OnInit, AfterViewInit, OnDestroy {

  configuration: RTCConfiguration = {
    iceServers: [
      {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:a.relay.metered.ca:443",
        username: "e9741a368572eb0d70ed9c24",
        credential: "42FqG9SKYwaiW1UZ",
      }
    ]
  };
  peerConnections: Map<string, RTCPeerConnection> = new Map();
  peerConnection = new RTCPeerConnection(this.configuration);

  constructor(private webRtcService: WebrtcService,
              private mediaDeviceService: MediaDeviceService
  ) {
  }

  @Input() UniqueId: string;
  remoteStreams: BehaviorSubject<Map<string, MediaStream>> = new BehaviorSubject(new Map());
  newStream: Subscription;
  newCandidates: Subscription;
  newViewer: Subscription;
  newAnswer: Subscription;
  newOffer: Subscription;
  stopStream: Subscription;
  startStream: Subscription;

  ngOnInit(): void {
    this.startStream = this.webRtcService.startStream.subscribe(o => {
      if (o) {
        this.StartDisplay();
      }
    });
  }

  ngOnDestroy(): void {
    this.newStream.unsubscribe();
    this.newCandidates.unsubscribe();
    this.newViewer.unsubscribe();
    this.newAnswer.unsubscribe();
    this.newOffer.unsubscribe();
    this.stopStream.unsubscribe();
    this.startStream.unsubscribe();
  }

  async createOffer(peerConnection: RTCPeerConnection): Promise<void> {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
  }

  ngAfterViewInit(): void {
    this.newStream = this.webRtcService.streamStart.subscribe(o => {
      if (o) {
        this.webRtcService.JoinWebRtcStream(this.UniqueId);
      }
    })
    this.newViewer = this.webRtcService.joinStream.subscribe(o => {
      if (o) {
        const video = document.querySelector('#webRtcVideo') as HTMLVideoElement;
        this.createIce(o, video.srcObject as MediaStream);
      }
    });
    this.newCandidates = this.webRtcService.streamCandidates.subscribe(c => {
      if (c && c.candidate) {
        if (c.viewerId) {
          const pc = this.peerConnections.get(c.viewerId);
          if (!pc) return;
          pc.addIceCandidate(new RTCIceCandidate(c))
          return;
        }
        this.peerConnection.addIceCandidate(new RTCIceCandidate(c));
      }
    });
    this.newAnswer = this.webRtcService.streamAnswers.subscribe(async a => {
      if (a && a.sdp) {
        const pc = this.peerConnections.get(a.viewerId);
        if (!pc || pc.signalingState == "stable") return;
        await pc.setRemoteDescription(new RTCSessionDescription({sdp: a.sdp, type: a.type as RTCSdpType}));
        pc.onicecandidate = (c) => {
          if (c.candidate) {
            this.webRtcService.SendIceCandidateToViewer(c.candidate, a.viewerId);
          }
        };
      }
    });
    this.newOffer = this.webRtcService.streamOffer.subscribe(async o => {
      if (o && o.sdp) {
        await this.onReceiveSignal(o);
      }
    });
    this.stopStream = this.webRtcService.streamStop.subscribe(o => {
      if (o) {
        this.peerConnection.close();
      }
    });
    if (adapter.browserDetails.browser === 'chrome' &&
      adapter.browserDetails.version >= 107) {
    } else if (adapter.browserDetails.browser === 'firefox') {
      adapter.browserShim.shimGetDisplayMedia(window, 'screen');
    }
  }

  StartDisplay() {
    this.mediaDeviceService.getDevice()
      .then((e) => this.handleSuccess(e), (e) => {
        alert(`getDisplayMedia error: ${e}`)
      });
  }

  handleSuccess(stream) {
    this.webRtcService.StartWebRtcStream(this.UniqueId);
    const video = document.querySelector('#webRtcVideo') as HTMLVideoElement;
    video.srcObject = stream;
    stream.getVideoTracks()[0].addEventListener('ended', () => {
      this.webRtcService.StopWebRtcStream(this.UniqueId);
      this.peerConnections.forEach((pc) => {
        pc.close();
      });
      this.peerConnections.clear();
    });
  }

  async createIce(viewerId: string, stream: MediaStream) {
    try {
      const peerConnection = new RTCPeerConnection(this.configuration);
      this.peerConnections.set(viewerId, peerConnection);
      const video = document.querySelector('#webRtcVideo') as HTMLVideoElement;
      video.srcObject = stream;
      if (stream) {
        stream.getTracks().forEach(track => {
          peerConnection.addTrack(track, stream);
        });
      }
      const offerOptions: RTCOfferOptions = {offerToReceiveAudio: true, offerToReceiveVideo: true};
      var desc = await peerConnection.createOffer(offerOptions);
      let offer: WebRtcClientOffer = {sdp: desc.sdp, type: desc.type.toString(), viewerId: null};
      await peerConnection.setLocalDescription(desc);
      this.webRtcService.SendOfferToViewer(offer, viewerId);
    } catch (err) {
      alert(`Error creating offer: ${err}`);
      return;
    }
  }

  async onReceiveSignal(signal: WebRtcClientOffer): Promise<void> {
    if (signal.type === 'answer') {
    } else if (signal.type === 'offer') {
      this.peerConnection = new RTCPeerConnection(this.configuration);
      this.peerConnection.onicecandidate = c => {
        if (c.candidate) {
          this.webRtcService.SendIceCandidate(c.candidate, this.UniqueId);
        }
      };
      const video = document.querySelector('#webRtcVideo') as HTMLVideoElement;
      this.peerConnection.ontrack = event => {
        video.srcObject = event.streams[0];
      };
      this.peerConnection.setRemoteDescription(new RTCSessionDescription({type: signal.type, sdp: signal.sdp}));
      const desc = await this.peerConnection.createAnswer();
      this.peerConnection.setLocalDescription(desc);
      let offer: WebRtcClientOffer = {sdp: desc.sdp, type: desc.type.toString(), viewerId: null};
      this.webRtcService.CreateStreamAnswer(offer, this.UniqueId);
    }
  }

  protected readonly PlayerType = PlayerType;
}
