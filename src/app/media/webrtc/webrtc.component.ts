import { AfterViewInit, Component, OnInit } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { hubConnection } from '../../services/signal-r.service';
declare var adapter: any;

@Component({
  selector: 'app-webrtc',
  templateUrl: './webrtc.component.html',
  styleUrls: ['./webrtc.component.scss']
})
export class WebrtcComponent implements OnInit, AfterViewInit {

  constructor() { }
  localStream: BehaviorSubject<MediaStream> = new BehaviorSubject(null);
  remoteStreams: BehaviorSubject<Map<string, MediaStream>> = new BehaviorSubject(new Map());

  preferredDisplaySurface;
  startButton;

  ngOnInit(): void {
    hubConnection.on('ReceiveSignal', this.onReceiveSignal.bind(this));
  }

  private onReceiveSignal(fromConnectionId: string, signal: RTCSessionDescriptionInit | RTCIceCandidate): void {
    // Handle incoming WebRTC signaling here
  }

  async startLocalStream(videoConstraints: MediaTrackConstraints = { width: 1280, height: 720 }): Promise<void> {
    const mediaStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
    this.localStream.next(mediaStream);
  }

  async createOffer(peerConnection: RTCPeerConnection, targetConnectionId: string): Promise<void> {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    hubConnection.send('SendSignal', targetConnectionId, offer);
  }

    ngAfterViewInit(): void {
      this.preferredDisplaySurface = document.getElementById('displaySurface') as HTMLSelectElement;
      this.startButton = document.getElementById('startButton') as HTMLButtonElement;
      if (adapter.browserDetails.browser === 'chrome' &&
          adapter.browserDetails.version >= 107) {
        document.getElementById('options').style.display = 'block';
      } else if (adapter.browserDetails.browser === 'firefox') {
        adapter.browserShim.shimGetDisplayMedia(window, 'screen');
      }
    }

    StartDisplay() {
      const options = {audio: true, video: true};
      const displaySurface = this.preferredDisplaySurface.options[this.preferredDisplaySurface.selectedIndex].value;
      if (displaySurface !== 'default') {
        //options.video = {displaySurface};
      }
      navigator.mediaDevices.getDisplayMedia(options)
          .then(() => this.handleSuccess, (e) => {alert(`getDisplayMedia error: ${e}`)});
    }

    handleSuccess(stream) {
      const video = document.querySelector('#webRtcVideo') as HTMLVideoElement;
      video.srcObject = stream;
      this.createIce(stream);
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        alert('The user has ended sharing the screen');
      });
    }

    async createIce(stream) {
      try {
        var config = {
        }
        const offerOptions: RTCOfferOptions = {offerToReceiveAudio: true, offerToReceiveVideo: true};
        var pc = new RTCPeerConnection(config);
        pc.onicecandidate = (c) => {console.log(c)};
        pc.onicegatheringstatechange = (c) => {console.log(c)};
        pc.onicecandidateerror = (c) => {console.log(c)};
        if (stream) {
          stream.getTracks().forEach(track => pc.addTrack(track, stream));
        }
        var desc = await pc.createOffer(offerOptions);
        console.log("----------------")
        console.log(desc);
      } catch (err) {
        alert(`Error creating offer: ${err}`);
        return;
      }
    }

}
