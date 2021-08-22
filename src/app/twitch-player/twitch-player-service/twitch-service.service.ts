import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { hubConnection } from 'src/app/services/signal-r.service';

@Injectable({
  providedIn: 'root'
})
export class TwitchService {
  
  Playing: BehaviorSubject<boolean> = new BehaviorSubject(null);
  Time: BehaviorSubject<number> = new BehaviorSubject(null);
  constructor() { }

  
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
