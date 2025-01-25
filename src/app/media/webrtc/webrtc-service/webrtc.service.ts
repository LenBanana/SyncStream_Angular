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
  streamStart: BehaviorSubject<string> = new BehaviorSubject(null);
  constructor(private http: HttpClient, private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed === false) {
      }
      if (isClosed === true) {
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
