import { AfterViewInit, Component, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { getCookie } from '../../global.settings';
import { delay } from '../../helper/generic';
import { VideoDTO } from '../../Interfaces/VideoDTO';
import { PlayerService } from '../../player/player-service/player.service';
import { PlayerType } from '../../player/player.component';
import { PlaylistService } from '../../playlist/playlist-service/playlist.service';
import { MediaService } from '../media-service/media.service';
declare var $: any;
import mpegts from 'mpegts.js';
import { DialogService } from '../../text-dialog/text-dialog-service/dialog-service.service';

@Component({
  selector: 'app-mpegts-player',
  templateUrl: './mpegts-player.component.html',
  styleUrls: ['./mpegts-player.component.scss']
})
export class MpegtsPlayerComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {

  constructor(private playlistService: PlaylistService, private playerService: PlayerService, private mediaService: MediaService, private dialogService: DialogService) { }
  @Input() CurrentPlayerType = PlayerType.Live;
  @Input() IsHost = true;
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
  player: mpegts.Player;
  currentVid: VideoDTO;
  waitTimeout: NodeJS.Timeout;
  errorCount = 0;
  maxErrorCount = 24; // 1 minute of retries
  volume = 1;
  mouseTimeout;
  ngOnInit(): void {
    var volumeStorage = localStorage.getItem('livePlayerVolume');
    if (volumeStorage) {
      this.volume = Number.parseFloat(volumeStorage);
    }
  }

  ngAfterViewInit(): void {
    this.IsReady = true;
    this.AddSubscriptions();
  }


  ngOnChanges() {
    if (this.IsReady && this.CurrentPlayerType != PlayerType.Live) {
      this.player.pause();
    }
  }

  ngOnDestroy() {
    this.IsPlayingUpdate?.unsubscribe();
    this.VideoUpdate?.unsubscribe();
    this.ServerTimeUpdate?.unsubscribe();
    this.player?.unload();
    this.player?.off("play", () => {});
    this.player?.off("pause", () => {});
    this.player?.off("timeupdate", () => {});
    this.player?.off("ended", () => {});
    this.player?.off("ready", () => {});
    this.player?.off("volumechange", () => {});
  }

  AddSubscriptions() {
    //Video update from server
    this.VideoUpdate = this.playerService.player.subscribe(async vid => {
      await delay(10);
      if (!this.IsReady || this.CurrentPlayerType != PlayerType.Live || !vid) {
        return;
      }
      if (vid.url.includes('//drecktu.be:8088/live') || vid.url.includes('live.drecktu.be')) {
        var Token = getCookie("login-token");
        if (Token) {
          vid.url += "&app=live&port=1935&token=" + Token;
        } else {
          this.dialogService.PushPermissionDialog();
          return;
        }
      }
      this.setVideo(vid);
    });
  }

  setVideo(vid: VideoDTO) {
    this.currentVid = vid;
    if (mpegts.getFeatureList().mseLivePlayback) {
      var videoElement = document.getElementById('MpegtsPlayer') as HTMLMediaElement;
      this.player?.unload();
      this.player = mpegts.createPlayer({
          type: 'flv',
          isLive: true,
          url: vid.url,
          cors: true,
      }, {
        isLive: true
      }
      );
      this.player.attachMediaElement(videoElement);
      this.player.load();
      this.player.play();
      this.InitPlayer();
    }
  }

  SeekLive() {
    this.player.currentTime = this.player.buffered.end(0) - .15;
  }

  IsLive() {
    return (this.player.currentTime + 1) >= this.player.buffered.end(0)
  }

  InitPlayer() {
    var videoElement = document.getElementById('MpegtsPlayer') as HTMLMediaElement;
    videoElement.removeEventListener("canplay", e => {});
    videoElement.removeEventListener("waiting", e => {});
    this.player.volume = this.volume;
    clearTimeout(this.mouseTimeout);
    this.mouseTimeout = setTimeout(() => {
      $('#MpegtsLiveBtn').addClass('hide');
      $('#directLeaveBtn').addClass('hide');
    }, 2000);
    this.player.off(mpegts.Events.ERROR, e => {});
    this.player.on(mpegts.Events.ERROR, event => {
      if (!this.IsHost) {
        return;
      }
      if (event == "NetworkError") {
        if ((!this.IsPlaying || this.errorCount >= this.maxErrorCount) && this.UniqueId && this.UniqueId.length > 0) {
          this.playlistService.nextVideo(this.UniqueId);
        }
        else {
          this.errorCount++;
        }
      }
    });
    videoElement.addEventListener("canplay", ready => {
      this.player.play();
      if (this.IsPlaying) {
        this.errorCount = 0;
        clearTimeout(this.waitTimeout);
      }
      this.IsPlaying = true;
    })
    videoElement.addEventListener("volumechange", vol => {
      if (this.player.muted) this.volume = 0; else this.volume = this.player.volume;
      localStorage.setItem('livePlayerVolume', this.volume.toString());
    })
    videoElement.addEventListener("waiting", ready => {
      if (this.IsPlaying) {
        clearTimeout(this.waitTimeout);
        this.waitTimeout = setTimeout(() => {
          this.setVideo(this.currentVid);
        }, 5000);
      }
    })
    videoElement.addEventListener("mousemove", ready => {
      clearTimeout(this.mouseTimeout);
      $('#MpegtsLiveBtn').removeClass('hide');
      $('#directLeaveBtn').removeClass('hide');
      this.mouseTimeout = setTimeout(() => {
        $('#MpegtsLiveBtn').addClass('hide');
        $('#directLeaveBtn').addClass('hide');
      }, 2000);
    })
  }
}
