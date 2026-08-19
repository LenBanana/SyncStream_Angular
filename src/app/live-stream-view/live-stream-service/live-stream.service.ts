import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

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
    hubConnection.invoke('GetUsersWatching', userName);
  }

  public GetLiveUsers() {
    hubConnection.invoke('GetLiveUsers');
  }
}
