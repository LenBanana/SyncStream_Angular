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
declare var $: any;
import mpegts from 'mpegts.js';
import { AlertType, Dialog } from '../../Interfaces/Dialog';
import { DialogService } from '../../text-dialog/text-dialog-service/dialog-service.service';

@Component({
  selector: 'app-mpegts-player',
  templateUrl: './mpegts-player.component.html',
  styleUrls: ['./mpegts-player.component.scss']
})
export class MpegtsPlayerComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {

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
  player: mpegts.Player;
  currentVid: VideoDTO;
  waitTimeout: NodeJS.Timeout;
  errorCount = 0;
  maxErrorCount = 24; // 1 minute of retries
  ngOnInit(): void {
    this.IsReady = true;
    this.AddSubscriptions();
  }

  ngAfterViewInit(): void {
  }


  ngOnChanges() {
    if (this.IsReady && this.CurrentPlayerType != PlayerType.Live) {
      this.player.pause();
    }
  }

  ngOnDestroy() {
    this.IsPlayingUpdate.unsubscribe();
    this.VideoUpdate.unsubscribe();
    this.ServerTimeUpdate.unsubscribe();
    this.player?.unload();
    this.player?.off("play", () => {});
    this.player?.off("pause", () => {});
    this.player?.off("timeupdate", () => {});
    this.player?.off("ended", () => {});
    this.player?.off("ready", () => {});
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
          const dialog: Dialog = { id: "content-perm-mpegts", header: "Permission error", question: "Permission to content denied.", answer1: null, answer2: null, yes: null, no: null, alertType: AlertType.Danger };
          this.dialogService.newDialog.next(dialog);
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
          cors: true
      }, {
        enableStashBuffer: false,
        isLive: true,
        liveBufferLatencyChasing: true,
      }
      );
      this.player.attachMediaElement(videoElement);
      this.player.load();
      this.player.play();
      this.InitPlayer();
    }
  }

  InitPlayer() {
    var videoElement = document.getElementById('MpegtsPlayer') as HTMLMediaElement;
    this.player.on(mpegts.Events.ERROR, event => {
      if (!this.IsHost) {
        return;
      }
      if (event == "NetworkError") {
        if (!this.IsPlaying || this.errorCount >= this.maxErrorCount) {
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
    videoElement.addEventListener("waiting", ready => {
      if (this.IsPlaying) {
        clearTimeout(this.waitTimeout);
        this.waitTimeout = setTimeout(() => {
          this.setVideo(this.currentVid);
        }, 2500);
      }
    })
  }
}
