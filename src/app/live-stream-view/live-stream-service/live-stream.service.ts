import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { token } from '../../global.settings';
import { LiveUser } from '../../Interfaces/liveStream';
import { User } from '../../Interfaces/User';
import { hubConnection, SignalRService } from '../../services/signal-r.service';

@Injectable({
  providedIn: 'root'
})
export class LiveStreamService {

  liveChannels: BehaviorSubject<LiveUser[]> = new BehaviorSubject(null);
  watchingUser: BehaviorSubject<User[]> = new BehaviorSubject(null);
  constructor(private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addLiveChannelListener();
        this.addWatchingChannelListener();
        //this.GetLiveUsers();
      }
      if (isClosed===true) {
        this.removeLiveChannelListener();
        this.removeWatchingChannelListener();
      }
    });
   }

  public addLiveChannelListener() {
    hubConnection.on('getliveusers', (data) => {
      this.liveChannels.next(data);
    });
  }

  public removeLiveChannelListener() {
    hubConnection.off('getliveusers');
    this.liveChannels.next(null);
  }

  public addWatchingChannelListener() {
    hubConnection.on('getwatchingusers', (data) => {
      this.watchingUser.next(data);
    });
  }

  public removeWatchingChannelListener() {
    hubConnection.off('getwatchingusers');
    this.watchingUser.next(null);
  }

  public GetUsersWatching(userName: string) {
    if (token) {
      hubConnection.invoke('GetUsersWatching', token, userName);
    }
  }

  public GetLiveUsers() {
    if (token) {
      hubConnection.invoke('GetLiveUsers', token);
    }
  }
}
