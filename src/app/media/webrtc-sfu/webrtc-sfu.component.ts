import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Subscription } from 'rxjs';
import {WebrtcService} from "../webrtc/webrtc-service/webrtc.service";

@Component({
  selector: 'app-webrtc-sfu',
  templateUrl: './webrtc-sfu.component.html',
  styleUrls: ['./webrtc-sfu.component.scss']
})
export class WebrtcSfuComponent implements OnInit, OnDestroy {
  @ViewChild('remoteVideo') remoteVideo: ElementRef<HTMLVideoElement>;

  private peerConnection: RTCPeerConnection;
  private subscriptions: Subscription[] = [];

  constructor(private webRtcService: WebrtcService) { }

  ngOnInit(): void {
    this.initPeerConnection();
  }

  ngOnDestroy(): void {
    this.cleanup();
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  private async initPeerConnection() {
    const configuration = await this.webRtcService.getWebRtcConfig();
    this.peerConnection = new RTCPeerConnection(configuration);

    this.peerConnection.onnegotiationneeded = async () => {
      await this.createOffer();
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendIceCandidate(event.candidate);
      }
    };

    this.peerConnection.ontrack = (event) => {
      this.remoteVideo.nativeElement.srcObject = event.streams[0];
    };
  }

  async createOffer(): Promise<void> {
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    this.sendOffer(offer);
  }

  private sendOffer(offer: RTCSessionDescriptionInit): void {
    // Implement signaling logic here
  }

  private sendIceCandidate(candidate: RTCIceCandidate): void {
    // Implement signaling logic here
  }

  private cleanup(): void {
    if (this.peerConnection) {
      this.peerConnection.close();
    }

    const videoElem = this.remoteVideo.nativeElement;
    const tracks = (videoElem.srcObject as MediaStream)?.getTracks();
    tracks?.forEach(track => track.stop());
  }

  private onMessageReceived(message: any): void {
    // Handle incoming messages from the SFU
  }

  async startStreaming(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.getTracks().forEach(track => {
      this.peerConnection.addTrack(track, stream);
    });
  }

  stopStreaming(): void {
    this.cleanup();
  }
}
