import { AfterViewInit, Component, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import Plyr from 'plyr';
import { Subscription } from 'rxjs';
import { getCookie } from '../../global.settings';
import { delay } from '../../helper/generic';
import { VideoDTO } from '../../Interfaces/VideoDTO';
import { PlayerService } from '../../player/player-service/player.service';
import { PlayerType } from '../../player/player.component';
import { PlaylistService } from '../../playlist/playlist-service/playlist.service';
import { baseUrl } from '../../services/signal-r.service';
import { MediaService } from '../media-service/media.service';
import { AlertType, Dialog } from '../../Interfaces/Dialog';
import { DialogService } from '../../text-dialog/text-dialog-service/dialog-service.service';
declare var $: any;

@Component({
  selector: 'app-html5-player',
  templateUrl: './html5-player.component.html',
  styleUrls: ['./html5-player.component.scss']
})
export class Html5PlayerComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {

  constructor(private playlistService: PlaylistService, private playerService: PlayerService, private mediaService: MediaService, private dialogService: DialogService) { }
  @Input() CurrentPlayerType = PlayerType.Nothing;
  @Input() IsHost = false;
  @Input() UniqueId = "";
  @Input() CurrentPing = 0;
  @Input() Threshhold = .5;
  PlayerType = PlayerType;
  IsPlaying = false;
  IsReady = false;
  TimeUpdate: NodeJS.Timeout;
  IsPlayingUpdate: Subscription;
  VideoUpdate: Subscription;
  ServerTimeUpdate: Subscription;
  html5player: HTMLVideoElement;

  ngOnInit(): void {
  }

  ngAfterViewInit(): void {
    this.html5player = document.getElementById('HTML5VideoPlayer') as HTMLVideoElement;
    this.InitPlayer();
  }


  ngOnChanges() {
    if (this.IsReady && this.CurrentPlayerType != PlayerType.External) {
      this.html5player.pause();
    }
  }

  ngOnDestroy() {
    this.IsPlayingUpdate?.unsubscribe();
    this.VideoUpdate?.unsubscribe();
    this.ServerTimeUpdate?.unsubscribe();
    this.html5player.removeEventListener("play", () => {});
    this.html5player.removeEventListener("pause", () => {});
    this.html5player.removeEventListener("timeupdate", () => {});
    this.html5player.removeEventListener("ended", () => {});
    this.html5player.removeEventListener("canplay", () => {});
  }

  AddSubscriptions() {
    //Time update from server
    this.ServerTimeUpdate = this.playerService.currentTime.subscribe(t => {
      if (!this.IsReady || !t || t == null || this.IsHost || this.CurrentPlayerType != PlayerType.External) {
        return;
      }
      let playerTime = this.html5player.currentTime;
      if (playerTime >= 0 && ((t > (playerTime + this.Threshhold) || t < (playerTime - this.Threshhold)))) {
        this.html5player.currentTime = t + this.CurrentPing;
      }
    });
    //Play/Pause update from server
    this.IsPlayingUpdate = this.playerService.isplaying.subscribe(isplaying => {
      if (isplaying != null) {
        this.IsPlaying = isplaying;
      }
      if (!this.IsReady || this.IsHost || this.CurrentPlayerType != PlayerType.External) {
        return;
      }
      if (isplaying) {
        this.html5player.play();
      } else if (!isplaying) {
        this.html5player.pause();
      }
    });
    //Video update from server
    this.VideoUpdate = this.playerService.player.subscribe(async vid => {
      await delay(10);
      if (!this.IsReady || this.CurrentPlayerType != PlayerType.External || !vid) {
        return;
      }
      if (vid.url.startsWith(baseUrl)) {
        var Token = getCookie("login-token");
        if (Token) {
          vid.url += "&token=" + Token;
        } else {
          this.dialogService.PushPermissionDialog();
          return;
        }
      }
      this.setVideo(vid);
    });
  }

  setVideo(vid: VideoDTO) {
    $('#dialogModal-Sync').modal('hide');
    this.html5player.setAttribute('type', 'video/mp4');
    this.html5player.setAttribute('title', vid.title);
    if (vid.url.includes(".m3u8")) {
      this.html5player.setAttribute('type', 'application/x-mpegURL');
    }
    this.html5player.setAttribute('src', vid.url);
  }

  InitPlayer() {
    this.html5player.addEventListener("play", event => {
      if (this.IsHost) {
        this.playerService.PlayPause(true, this.UniqueId);
      } else {
        if (!this.IsPlaying && this.CurrentPlayerType == PlayerType.External) {
          this.html5player.pause();
        }
      }
    });
    this.html5player.addEventListener("pause", event => {
      if (this.IsHost) {
        this.playerService.PlayPause(false, this.UniqueId);
      } else {
        if (this.IsPlaying && this.CurrentPlayerType == PlayerType.External) {
          this.html5player.play();
        }
      }
    });
    this.html5player.addEventListener("timeupdate", timeupdated => {
      if (!this.IsHost || this.CurrentPlayerType != PlayerType.External) {
        return;
      }
      this.mediaService.playerTime.next(this.html5player.currentTime);
    });
    this.html5player.addEventListener("ended", end => {
      this.html5player.pause();
      if (!this.IsHost) {
        return;
      }
      this.playlistService.nextVideo(this.UniqueId);
    });
    this.IsReady = true;
    this.AddSubscriptions();
  }

}
