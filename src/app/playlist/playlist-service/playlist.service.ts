import { Injectable } from '@angular/core';
import * as signalR from "@microsoft/signalr";
import { VideoDTO } from '../../Interfaces/VideoDTO';
import { hubConnection, baseUrl, SignalRService , logHubFailure} from '../../services/signal-r.service';
import { BehaviorSubject, from } from 'rxjs';
import { HttpClient } from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class PlaylistService {

  playlist: BehaviorSubject<VideoDTO[]> = new BehaviorSubject(null);
  constructor(private http: HttpClient, private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addPlaylistListener();
      }
      if (isClosed===true) {
        this.removePlaylistListener();
      }
    });
   }

  public NullAllSubs() {
    this.playlist.next(null);
  }

  public addPlaylistListener() {
    hubConnection.on('playlistupdate', (data) => {
      this.playlist.next(data);
    });
  }

  public removePlaylistListener() {
    hubConnection.off('playlistupdate');
    this.playlist.next(null);
  }

  public addVideo(key: VideoDTO, UniqueId: string) {
    hubConnection.invoke('AddVideo', key, UniqueId).catch(logHubFailure);
  }

  public removeVideo(key: string, UniqueId: string) {
    hubConnection.invoke('RemoveVideo', key, UniqueId).catch(logHubFailure);
  }

  public nextVideo(UniqueId: string) {
    hubConnection.invoke('NextVideo', UniqueId).catch(logHubFailure);
  }

  public playVideo(key: string, UniqueId: string) {
    hubConnection.invoke('PlayVideo', key, UniqueId).catch(logHubFailure);
  }

  public moveVideo(fromIdx: number, toIdx: number, UniqueId: string) {
    hubConnection.invoke('MoveVideo', fromIdx, toIdx, UniqueId).catch(logHubFailure);
  }

}
