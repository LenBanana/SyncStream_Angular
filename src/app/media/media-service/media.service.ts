import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {token} from "../../global.settings";
import {hubConnection} from "../../services/signal-r.service";

@Injectable({
  providedIn: 'root'
})
export class MediaService {

  playerTime: BehaviorSubject<number> = new BehaviorSubject(null);
  constructor() { }
  public SendPlayerType(roomId: string) {
    if (token) {
      hubConnection.invoke('SendPlayerType', token, roomId);
    }
  }
}
