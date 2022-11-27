import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { hubConnection, SignalRService } from '../../services/signal-r.service';

@Injectable({
  providedIn: 'root'
})
export class TwitchService {

  Playing: BehaviorSubject<boolean> = new BehaviorSubject(null);
  Time: BehaviorSubject<number> = new BehaviorSubject(null);
  constructor(private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addPlayingListener();
        this.addTimeListener();
      }
      if (isClosed===true) {
        this.removePlayingListener();
        this.removeTimeListener();
      }
    });
   }

  public NullAllSubs() {
    this.Playing.next(null);
    this.Time.next(null);
  }


  public addPlayingListener() {
    hubConnection.on('twitchPlaying', (data) => {
      this.Playing.next(data);
    });
  }

  public removePlayingListener() {
    hubConnection.off('twitchPlaying');
    this.Playing.next(null);
  }

  public addTimeListener() {
    hubConnection.on('twitchTimeUpdate', (data) => {
      this.Time.next(data);
    });
  }

  public removeTimeListener() {
    hubConnection.off('twitchTimeUpdate');
    this.Time.next(null);
  }
}
