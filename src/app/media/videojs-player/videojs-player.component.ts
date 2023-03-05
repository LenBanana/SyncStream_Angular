import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, OnInit, ViewChild } from '@angular/core';
import videojs from 'video.js';
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
  selector: 'app-videojs-player',
  templateUrl: './videojs-player.component.html',
  styleUrls: ['./videojs-player.component.scss']
})
export class VideojsPlayerComponent implements AfterViewInit, OnDestroy, OnChanges {

  constructor(private playlistService: PlaylistService, private playerService: PlayerService, private mediaService: MediaService, private dialogService: DialogService) { }
  @Input() CurrentPlayerType = PlayerType.Nothing;
  @Input() IsHost = false;
  @Input() UniqueId = "";
  @Input() CurrentPing = 0;
  @Input() Threshhold = .5;
  PlayerType = PlayerType;
  IsPlaying = false;
  IsReady = false;
  LiveStream = false;
  TimeUpdate: NodeJS.Timeout;
  IsPlayingUpdate: Subscription;
  VideoUpdate: Subscription;
  ServerTimeUpdate: Subscription;
  @ViewChild('videojsplayer', {static: true}) videojselement: ElementRef;
  videojsplayer: videojs.Player;
  volume = 1;

  ngAfterViewInit(): void {
    this.videojsplayer = videojs(this.videojselement.nativeElement, {
      autoplay: 'play',
      controls: true,
      preload: 'auto',
      enableWorker: true,
      liveDurationInfinity: false,
      liveui: true
    }, onPlayerReady => {
      this.InitPlayer();
    });
  }

  SeekLive() {
    if (this.IsHost) {
      this.videojsplayer.currentTime(this.videojsplayer.liveTracker.seekableEnd());
    }
  }

  ngOnChanges() {
    if (this.IsReady && this.CurrentPlayerType != PlayerType.External) {
      this.videojsplayer.pause();
    }
  }

  ngOnDestroy() {
    this.IsPlayingUpdate?.unsubscribe();
    this.VideoUpdate?.unsubscribe();
    this.ServerTimeUpdate?.unsubscribe();
    this.videojsplayer.off("play", () => {});
    this.videojsplayer.off("pause", () => {});
    this.videojsplayer.off("timeupdate", () => {});
    this.videojsplayer.off("ended", () => {});
    this.videojsplayer.off("canplay", () => {});
    this.videojsplayer?.off("volumechange", () => {});
    this.videojsplayer?.dispose();
  }

  AddSubscriptions() {
    //Time update from server
    this.ServerTimeUpdate = this.playerService.currentTime.subscribe(t => {
      if (!this.IsReady || !t || t == null || this.IsHost || this.CurrentPlayerType != PlayerType.External) {
        return;
      }
      let playerTime = this.videojsplayer.currentTime();
      if (playerTime >= 0 && ((t > (playerTime + this.Threshhold) || t < (playerTime - this.Threshhold)))) {
        this.videojsplayer.currentTime(t + this.CurrentPing);
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
        this.videojsplayer.play();
      } else if (!isplaying) {
        this.videojsplayer.pause();
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
          const dialog: Dialog = { id: "content-perm-mpegts", header: "Permission error", question: "Permission to content denied.", answer1: null, answer2: null, yes: null, no: null, alertType: AlertType.Danger };
          this.dialogService.newDialog.next(dialog);
          return;
        }
      }
      this.setVideo(vid);
    });
  }

  setVideo(vid: VideoDTO) {
    $('#dialogModal-Sync').modal('hide');
    this.LiveStream = false;
    if (vid.url.includes(".m3u8")) {
      this.LiveStream = true;
      this.videojsplayer.src({
        type: 'application/x-mpegURL',
        src: vid.url,
        title: vid.title
      });
      return;
    }
    if (vid.url.toLocaleLowerCase().startsWith('https://dash.drecktu.be/dash')) {
      this.videojsplayer.src({
        type: 'application/dash+xml',
        src: vid.url,
        title: vid.title
      });
      return;
    }
    if (vid.url.toLocaleLowerCase().startsWith('rtmp')) {
      this.videojsplayer.src({
        type: 'rtmp/mp4',
        src: vid.url,
        title: vid.title
      });
      return;
    }
    this.videojsplayer.src({
      type: 'video/mp4',
      src: vid.url,
      title: vid.title
    });
  }

  InitPlayer() {
    var volumeStorage = localStorage.getItem('jsPlayerVolume');
    if (volumeStorage) {
      this.volume = Number.parseFloat(volumeStorage);
      this.videojsplayer.volume(this.volume);
    }
    this.videojsplayer.on("play", event => {
      if (this.IsHost) {
        this.playerService.PlayPause(true, this.UniqueId);
      } else {
        if (!this.IsPlaying && this.CurrentPlayerType == PlayerType.External) {
          this.videojsplayer.pause();
        }
      }
    });
    this.videojsplayer.on("pause", event => {
      if (this.IsHost) {
        this.playerService.PlayPause(false, this.UniqueId);
      } else {
        if (this.IsPlaying && this.CurrentPlayerType == PlayerType.External) {
          this.videojsplayer.play();
        }
      }
    });
    this.videojsplayer.on("timeupdate", timeupdated => {
      if (!this.IsHost || this.CurrentPlayerType != PlayerType.External) {
        return;
      }
      this.mediaService.playerTime.next(this.videojsplayer.currentTime());
    });
    this.videojsplayer.on("volumechange", vol => {
      if (this.videojsplayer.muted()) this.volume = 0; else this.volume = this.videojsplayer.volume();
      localStorage.setItem('jsPlayerVolume', this.volume.toString());
    })
    this.videojsplayer.on("ended", end => {
      this.videojsplayer.pause();
      if (!this.IsHost) {
        return;
      }
      this.playlistService.nextVideo(this.UniqueId);
    });
    this.IsReady = true;
    this.AddSubscriptions();
  }
}
