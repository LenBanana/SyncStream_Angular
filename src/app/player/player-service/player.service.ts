import { Injectable } from '@angular/core';
import * as signalR from "@aspnet/signalr";
import { VideoDTO } from '../../Interfaces/VideoDTO';
import { hubConnection, baseUrl, SignalRService } from '../../services/signal-r.service';
import { BehaviorSubject } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { PlayerType } from '../player.component';

@Injectable({
  providedIn: 'root'
})
export class PlayerService {

  player: BehaviorSubject<VideoDTO> = new BehaviorSubject(null);
  isplaying: BehaviorSubject<boolean> = new BehaviorSubject(null);
  playerType: BehaviorSubject<PlayerType> = new BehaviorSubject(null);
  playingGallows: BehaviorSubject<string> = new BehaviorSubject(null);
  playingBlackjack: BehaviorSubject<boolean> = new BehaviorSubject(null);
  currentTime: BehaviorSubject<number> = new BehaviorSubject(null);
  playFile: BehaviorSubject<string> = new BehaviorSubject(null);
  constructor(private http: HttpClient, private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addBlackjackListener();
        this.addGallowListener();
        this.addPauseListener();
        this.addPlayerListener();
        this.addTimeListener();
        this.addPlayerTypeListener();
      }
      if (isClosed===true) {
        this.removeBlackjackListener();
        this.removeGallowListener();
        this.removePauseListener();
        this.removePlayerListener();
        this.removeTimeListener();
        this.removePlayerTypeListener();
      }
    });
   }

  public NullAllSubs() {
    this.player.next(null);
    this.currentTime.next(null);
    this.isplaying.next(null);
    this.playingGallows.next(null);
    this.playingBlackjack.next(null);
  }

  public addPlayerTypeListener() {
    hubConnection.on('playertype', (data: number) => {
      this.playerType.next(data);
    });
  }

  public removePlayerTypeListener() {
    hubConnection.off('playertype');
    this.playerType.next(PlayerType.Nothing);
  }

  public addPlayerListener() {
    hubConnection.on('videoupdate', (data) => {
      this.player.next(data);
    });
  }

  public removePlayerListener() {
    hubConnection.off('videoupdate');
    this.player.next(null);
  }

  public addTimeListener() {
    hubConnection.on('timeupdate', (data: number) => {
      this.currentTime.next(data);
    });
  }

  public removeTimeListener() {
    hubConnection.off('timeupdate');
    this.currentTime.next(null);
  }

  public addPauseListener() {
    hubConnection.on('isplayingupdate', (data) => {
      this.isplaying.next(data);
    });
  }

  public removePauseListener() {
    hubConnection.off('isplayingupdate');
    this.isplaying.next(null);
  }

  public addGallowListener() {
    hubConnection.on('playinggallows', (data) => {
      this.playingGallows.next(data);
    });
  }

  public removeGallowListener() {
    hubConnection.off('playinggallows');
    this.playingGallows.next(null);
  }

  public addBlackjackListener() {
    hubConnection.on('playblackjack', (data) => {
      this.playingBlackjack.next(data);
    });
  }

  public removeBlackjackListener() {
    hubConnection.off('playblackjack');
    this.playingBlackjack.next(null);
  }

  public PlayPause(isplaying: boolean, UniqueId: string) {
    hubConnection.invoke('PlayPause', isplaying, UniqueId);
  }

  public SetTime(time: number, UniqueId: string) {
    hubConnection.invoke('SetTime', time, UniqueId);
  }

  public GetYTInfo(url: string) {
    return this.http.get('https://noembed.com/embed?url=' + url).toPromise();
  }
}
