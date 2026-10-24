import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { LiveUser } from '../../Interfaces/liveStream';
import { User } from '../../Interfaces/User';
import { hubConnection, SignalRService , logHubFailure} from '../../services/signal-r.service';

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
    hubConnection.invoke('GetUsersWatching', userName).catch(logHubFailure);
  }

  public GetLiveUsers() {
    hubConnection.invoke('GetLiveUsers').catch(logHubFailure);
  }

  /**
   * The URL to play an OBS stream or a room's RTMP file share from, or null when nobody is streaming it. It
   * carries a ticket that is only good for starting a play within a couple of minutes, so ask again for every
   * connection attempt.
   */
  public playUrl(roomId: string | null, streamName: string): Promise<string | null> {
    return hubConnection.invoke<string | null>('GetLivePlayUrl', roomId, streamName);
  }
}
