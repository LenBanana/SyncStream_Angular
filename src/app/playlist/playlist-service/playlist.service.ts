import { Injectable } from '@angular/core';
import * as signalR from "@aspnet/signalr";
import { VideoDTO } from '../../Interfaces/VideoDTO';
import { hubConnection, baseUrl } from '../../services/signal-r.service';
import { BehaviorSubject, from } from 'rxjs';
import { HttpClient } from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class PlaylistService {

  playlist: BehaviorSubject<VideoDTO[]> = new BehaviorSubject(null);
  constructor(private http: HttpClient) { }


  public addPlaylistListener() {
    hubConnection.on('playlistupdate', (data) => {
      this.playlist.next(data);
    });
  }

  public removePlaylistListener() {
    hubConnection.off('playlistupdate', (data) => {
    });
  }

  public addVideo(key: VideoDTO, UniqueId: string) {
    hubConnection.invoke('AddVideo', key, UniqueId);
  }

  public removeVideo(key: string, UniqueId: string) {
    hubConnection.invoke('RemoveVideo', key, UniqueId);
  }

  public nextVideo(UniqueId: string) {
    hubConnection.invoke('NextVideo', UniqueId);
  }

  public playVideo(key: string, UniqueId: string) {
    hubConnection.invoke('PlayVideo', key, UniqueId);
  }

  public moveVideo(fromIdx: number, toIdx: number, UniqueId: string) {
    hubConnection.invoke('MoveVideo', fromIdx, toIdx, UniqueId);
  }


  // HTTP
  public async GetURLTitle(url: string): Promise<string> {
    var result = await this.http.get<any>(baseUrl + 'api/Server/ResolveURL/?url=' + url).toPromise();
    return result.title;
  }

}
