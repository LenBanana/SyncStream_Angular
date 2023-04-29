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
export var player: Plyr = undefined;
@Component({
  selector: 'app-plyr-player',
  templateUrl: './plyr-player.component.html',
  styleUrls: ['./plyr-player.component.scss']
})
export class PlyrPlayerComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {

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

  ngOnInit(): void {
    if (player === undefined) {
      player = new Plyr('#VideoPlayer', {
        autoplay: true,
        disableContextMenu: false,
        keyboard: {
          focused: true,
          global: true
        },
        invertTime: false
      });
      this.InitPlayer();
    }
  }

  ngAfterViewInit(): void {
  }


  ngOnChanges() {
    if (this.IsReady && this.CurrentPlayerType != PlayerType.Vimeo) {
      player.pause();
      player.stop();
    }
  }

  ngOnDestroy() {
    this.IsPlayingUpdate?.unsubscribe();
    this.VideoUpdate?.unsubscribe();
    this.ServerTimeUpdate?.unsubscribe();
    player.off("play", () => {});
    player.off("pause", () => {});
    player.off("timeupdate", () => {});
    player.off("ended", () => {});
    player.off("ready", () => {});
  }

  AddSubscriptions() {
    //Time update from server
    this.ServerTimeUpdate = this.playerService.currentTime.subscribe(t => {
      if (!this.IsReady || !t || t == null || this.IsHost || this.CurrentPlayerType != PlayerType.Vimeo) {
        return;
      }
      let playerTime = player.currentTime;
      if (playerTime >= 0 && ((t > (playerTime + this.Threshhold) || t < (playerTime - this.Threshhold)))) {
        if (player.buffered > 0) {
          player.currentTime = t + this.CurrentPing;
          //player.play();
        }
      }
    });
    //Play/Pause update from server
    this.IsPlayingUpdate = this.playerService.isplaying.subscribe(isplaying => {
      if (isplaying != null) {
        this.IsPlaying = isplaying;
      }
      if (!this.IsReady || this.IsHost || this.CurrentPlayerType != PlayerType.Vimeo) {
        return;
      }
      if (player.buffered > 0) {
        if (isplaying) {
          player.play();
        } else if (!isplaying) {
          player.pause();
        }
      }
    });
    //Video update from server
    this.VideoUpdate = this.playerService.player.subscribe(async vid => {
      await delay(10);
      if (!this.IsReady || this.CurrentPlayerType != PlayerType.Vimeo || !vid) {
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
    if (vid.url.includes(".m3u8")) {
      player.source = {
        title: vid.title,
        type: 'video',
        sources: [{
          src: vid.url,
          type: 'application/x-mpegURL',
        }],
      };
      return;
    }
    if (vid.url.includes('vimeo.com')) {
      const keys = vid.url.split('/');
      const key = keys[keys.length - 1];
      player.source = {
        title: vid.title,
        type: 'video',
        sources: [{
          src: key,
          provider: 'vimeo',
        }],
      };
      return;
    }
    player.source = {
      title: vid.title,
      type: 'video',
      sources: [{
        src: vid.url,
        type: 'video/mp4',
      }],
    };
  }

  InitPlayer() {
    player.on("play", event => {
      if (this.IsHost) {
        this.playerService.PlayPause(true, this.UniqueId);
      } else {
        if (!this.IsPlaying && this.CurrentPlayerType == PlayerType.Vimeo) {
          player.pause();
        }
      }
    });
    player.on("pause", event => {
      if (this.IsHost) {
        this.playerService.PlayPause(false, this.UniqueId);
      } else {
        if (this.IsPlaying && this.CurrentPlayerType == PlayerType.Vimeo) {
          player.play();
        }
      }
    });
    player.on("timeupdate", timeupdated => {
      if (!this.IsHost || this.CurrentPlayerType != PlayerType.Vimeo) {
        return;
      }
      const currentTime: number = timeupdated.detail.plyr.currentTime;
      this.mediaService.playerTime.next(currentTime);
    });
    player.on("ended", end => {
      player.stop();
      if (!this.IsHost) {
        return;
      }
      this.playlistService.nextVideo(this.UniqueId);
    });
    player.on("ready", ready => {
      if (!this.IsReady) {
        this.IsReady = true;
        this.AddSubscriptions();
      }
    })
  }

}
