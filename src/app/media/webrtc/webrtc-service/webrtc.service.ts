import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';
import {SignalRService, hubConnection, baseUrl} from '../../../services/signal-r.service';
import {token} from '../../../global.settings';
import {PlayerType} from "../../../player/player.component";
import {HttpClient} from "@angular/common/http";

@Injectable({
  providedIn: 'root'
})
export class WebrtcService {
  streamStop: BehaviorSubject<string> = new BehaviorSubject(null);
  streamCredentials: BehaviorSubject<WebRtcCredentials> = new BehaviorSubject(null);
  joinStream: BehaviorSubject<string> = new BehaviorSubject(null);
  streamStart: BehaviorSubject<string> = new BehaviorSubject(null);
  streamAnswers: BehaviorSubject<WebRtcClientOffer> = new BehaviorSubject(null);
  streamOffer: BehaviorSubject<WebRtcClientOffer> = new BehaviorSubject(null);
  streamCandidates: BehaviorSubject<WebRtcCandidateExchange> = new BehaviorSubject(null);
  startStream: BehaviorSubject<string> = new BehaviorSubject(null);

  constructor(private http: HttpClient, private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed === false) {
        this.addStreamStopListener();
        this.addStreamJoinListener();
        this.addStreamStartListener();
        this.addStreamOfferListener();
        this.addStreamAnswerListener();
        this.addStreamCandidateListener();
      }
      if (isClosed === true) {
        this.removeStreamStopListener();
        this.removeStreamJoinListener();
        this.removeStreamStartListener();
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

  public addStreamStartListener() {
    hubConnection.on('startWebRtcStream', (data) => {
      this.streamStart.next(data);
    });
  }

  public removeStreamStartListener() {
    hubConnection.off('startWebRtcStream', (data) => {
      this.streamStart.next(null)
    });
  }

  public addStreamStopListener() {
    hubConnection.on('stopWebRtcStream', (data) => {
      this.streamStop.next(data);
    });
  }

  public removeStreamStopListener() {
    hubConnection.off('stopWebRtcStream', (data) => {
      this.streamStop.next(null);
    });
  }


  public addStreamAnswerListener() {
    hubConnection.on('sendClientAnswer', (data) => {
      this.streamAnswers.next(data);
    });
  }

  public removeStreamAnswerListener() {
    hubConnection.off('sendClientAnswer', (data) => {
      this.streamAnswers.next(null);
    });
  }

  public addStreamCandidateListener() {
    hubConnection.on('sendIceCandidate', (data) => {
      this.streamCandidates.next(data);
    });
  }

  public removeStreamCandidateListener() {
    hubConnection.off('sendIceCandidate', (data) => {
      this.streamCandidates.next(null);
    });
  }

  public addStreamJoinListener() {
    hubConnection.on('joinWebRtcStream', (data) => {
      this.joinStream.next(data);
    });
  }

  public removeStreamJoinListener() {
    hubConnection.off('joinWebRtcStream', (data) => {
      this.joinStream.next(null);
    });
  }

  public addStreamOfferListener() {
    hubConnection.on('sendOfferToViewer', (data) => {
      this.streamOffer.next(data);
    });
  }

  public removeStreamOfferListener() {
    hubConnection.off('sendOfferToViewer', (data) => {
      this.streamOffer.next(null);
    });
  }

  private GetWebRtcCredentials() {
    if (token) {
      return this.http.get<WebRtcCredentials>(baseUrl + "api/webrtc/GetWebRtcCredentials?token=" + token);
    }
  }

  public StartWebRtcStream(roomId: string) {
    if (token) {
      hubConnection.invoke('StartWebRtcStream', token, roomId);
    }
  }

  public SendOfferToViewer(offer: WebRtcClientOffer, viewerId: string) {
    if (token) {
      hubConnection.invoke('SendOfferToViewer', token, viewerId, offer);
    }
  }

  public StopWebRtcStream(roomId: string) {
    if (token) {
      hubConnection.invoke('StopWebRtcStream', token, roomId);
    }
  }

  public CreateStreamAnswer(answer: WebRtcClientOffer, roomId: string) {
    if (token) {
      hubConnection.invoke('CreateStreamAnswer', token, roomId, answer);
    }
  }

  public SendIceCandidate(iceCandidate: RTCIceCandidate, roomId: string) {
    if (token) {
      hubConnection.invoke('SendIceCandidate', token, roomId, iceCandidate);
    }
  }

  public SendIceCandidateToViewer(iceCandidate: RTCIceCandidate, viewerId: string) {
    if (token) {
      hubConnection.invoke('SendIceCandidateToViewer', token, viewerId, iceCandidate);
    }
  }

  public JoinWebRtcStream(roomId: string) {
    if (token) {
      hubConnection.invoke('JoinWebRtcStream', token, roomId);
    }
  }

  public CleanUpWebRtc() {
    this.streamStart.next(null);
    this.streamStop.next(null);
    this.joinStream.next(null);
    this.streamAnswers.next(null);
    this.streamOffer.next(null);
    this.streamCandidates.next(null);
    this.startStream.next(null);
  }
}

export interface WebRtcCredentials {
  username: string;
  password: string;
}

export interface WebRtcClientOffer {
  type: string,
  sdp: string,
  viewerId: string,
}

export enum Resolution {
  HD = 720,
  FHD = 1080,
  QHD = 1440,
  UHD = 2160
}

export interface WebRtcCandidateExchange extends RTCIceCandidate {
  viewerId: string;
}
