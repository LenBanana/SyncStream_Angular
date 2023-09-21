import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SignalRService, hubConnection, baseUrl } from '../../../services/signal-r.service';
import { HttpClient } from "@angular/common/http";
import {token} from "../../../global.settings";
import {
  WebRtcCandidateExchange,
  WebRtcClientOffer,
  WebRtcCredentials
} from "../../webrtc/webrtc-service/webrtc.service";

@Injectable({
  providedIn: 'root'
})
export class WebrtcSfuService {
  streamStop: BehaviorSubject<string> = new BehaviorSubject(null);
  streamCredentials: BehaviorSubject<WebRtcCredentials> = new BehaviorSubject(null);
  streamStart: BehaviorSubject<string> = new BehaviorSubject(null);
  streamAnswers: BehaviorSubject<WebRtcClientOffer> = new BehaviorSubject(null);
  streamOffer: BehaviorSubject<WebRtcClientOffer> = new BehaviorSubject(null);
  streamCandidates: BehaviorSubject<WebRtcCandidateExchange> = new BehaviorSubject(null);

  constructor(private http: HttpClient, private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed === false) {
        this.addStreamStartListener();
        this.addStreamStopListener();
        this.addStreamOfferListener();
        this.addStreamAnswerListener();
        this.addStreamCandidateListener();
      }
      if (isClosed === true) {
        this.removeStreamStartListener();
        this.removeStreamStopListener();
        this.removeStreamOfferListener();
        this.removeStreamAnswerListener();
        this.removeStreamCandidateListener();
      }
    });
  }

  public async getWebRtcConfig(): Promise<RTCConfiguration> {
    const credentials = await this.GetWebRtcCredentials().toPromise();
    return {
      iceServers: [
        {
          urls: 'stun:drecktu.be:3478'
        },
        {
          urls: 'turn:drecktu.be:3478?transport=udp',
          username: credentials.username,
          credential: credentials.password
        }
      ]
    };
  }

  private GetWebRtcCredentials() {
    if (token) {
      return this.http.get<WebRtcCredentials>(baseUrl + "api/webrtc/GetWebRtcCredentials?token=" + token);
    }
  }

  // Listeners for SignalR events
  public addStreamStartListener() {
    hubConnection.on('startSFUStream', (data) => {
      this.streamStart.next(data);
    });
  }

  public removeStreamStartListener() {
    hubConnection.off('startSFUStream');
  }

  public addStreamStopListener() {
    hubConnection.on('stopSFUStream', (data) => {
      this.streamStop.next(data);
    });
  }

  public removeStreamStopListener() {
    hubConnection.off('stopSFUStream');
  }

  public addStreamAnswerListener() {
    hubConnection.on('sendSFUAnswer', (data) => {
      this.streamAnswers.next(data);
    });
  }

  public removeStreamAnswerListener() {
    hubConnection.off('sendSFUAnswer');
  }

  public addStreamCandidateListener() {
    hubConnection.on('sendSFUIceCandidate', (data) => {
      this.streamCandidates.next(data);
    });
  }

  public removeStreamCandidateListener() {
    hubConnection.off('sendSFUIceCandidate');
  }

  public addStreamOfferListener() {
    hubConnection.on('sendOfferFromSFU', (data) => {
      this.streamOffer.next(data);
    });
  }

  public removeStreamOfferListener() {
    hubConnection.off('sendOfferFromSFU');
  }

  // Methods to send data to the SFU via SignalR
  public sendOfferToSFU(offer: WebRtcClientOffer) {
    if (token) {
      hubConnection.invoke('SendOfferToSFU', token, offer);
    }
  }

  public sendAnswerToSFU(answer: WebRtcClientOffer) {
    if (token) {
      hubConnection.invoke('SendAnswerToSFU', token, answer);
    }
  }

  public sendIceCandidateToSFU(iceCandidate: RTCIceCandidate) {
    if (token) {
      hubConnection.invoke('SendIceCandidateToSFU', token, iceCandidate);
    }
  }

  public joinSFUStream(roomId: string) {
    if (token) {
      hubConnection.invoke('JoinSFUStream', token, roomId);
    }
  }

  public leaveSFUStream(roomId: string) {
    if (token) {
      hubConnection.invoke('LeaveSFUStream', token, roomId);
    }
  }

  public cleanupSFU() {
    this.streamStart.next(null);
    this.streamStop.next(null);
    this.streamAnswers.next(null);
    this.streamOffer.next(null);
    this.streamCandidates.next(null);
  }
}

