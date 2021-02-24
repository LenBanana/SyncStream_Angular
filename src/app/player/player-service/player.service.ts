import { Injectable } from '@angular/core';
import * as signalR from "@aspnet/signalr";
import { VideoDTO } from '../../Interfaces/VideoDTO';
import { hubConnection, baseUrl } from '../../services/signal-r.service';
import { BehaviorSubject } from 'rxjs'; 

@Injectable({
  providedIn: 'root'
})
export class PlayerService {

  player: BehaviorSubject<VideoDTO> = new BehaviorSubject(null);
  isplaying: BehaviorSubject<boolean> = new BehaviorSubject(null);
  currentTime: BehaviorSubject<number> = new BehaviorSubject(null);
  constructor() { }

  public addPlayerListener() {
    hubConnection.on('videoupdate', (data) => {
      this.player.next(data);
    });
  }

  public removePlayerListener() {
    hubConnection.off('videoupdate', (data) => {
    });
  }

  public addTimeListener() {
    hubConnection.on('timeupdate', (data: number) => {
      this.currentTime.next(data);
    });
  }

  public removeTimeListener() {
    hubConnection.off('timeupdate', (data) => {
    });
  }

  public addPauseListener() {
    hubConnection.on('isplayingupdate', (data) => {
      this.isplaying.next(data);
    });
  }

  public removePauseListener() {
    hubConnection.off('isplayingupdate', (data) => {
    });
  }

  public PlayPause(isplaying: boolean, UniqueId: string) {
    hubConnection.invoke('PlayPause', isplaying, UniqueId);
  }

  public SetTime(time: number, UniqueId: string) {
    hubConnection.invoke('SetTime', time, UniqueId);
  }
}
