import { AfterViewInit, Component, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import Plyr from 'plyr';
import { Subscription } from 'rxjs';

import { delay } from '../../helper/generic';
import { VideoDTO } from '../../Interfaces/VideoDTO';
import { PlayerService } from '../../player/player-service/player.service';
import { PlayerType } from '../../player/player.component';
import { PlaylistService } from '../../playlist/playlist-service/playlist.service';
import { baseUrl } from '../../services/signal-r.service';
import { MediaService } from '../media-service/media.service';
import { AlertType, Dialog } from '../../Interfaces/Dialog';
import { DialogService } from '../../text-dialog/text-dialog-service/dialog-service.service';
import { PlaybackSyncService } from '../../media/sync/playback-sync.service';
import { MediaElementTarget } from '../../media/sync/playback-target';
import { startPlayback } from '../../media/sync/playback-start';
declare var $: any;

@Component({
  selector: 'app-html5-player',
  templateUrl: './html5-player.component.html',
  styleUrls: ['./html5-player.component.scss']
})
export class Html5PlayerComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {

  constructor(private playlistService: PlaylistService, private playerService: PlayerService, private mediaService: MediaService, private dialogService: DialogService, private playbackSync: PlaybackSyncService) { }
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
    this.ServerTimeUpdate = this.playerService.currentTime.subscribe(sync => {
      if (!this.IsReady || !sync || this.IsHost || this.CurrentPlayerType != PlayerType.External) {
        return;
      }
      this.playbackSync.apply(new MediaElementTarget(this.html5player), sync);
    });
    //Play/Pause update from server
    this.IsPlayingUpdate = this.playerService.isplaying.subscribe(isplaying => {
      // Null means the state is not known rather than not playing, and the subject is reset to it. Falling
      // through to the pause branch on it answers "no idea" by pausing.
      if (isplaying == null) {
        return;
      }
      this.IsPlaying = isplaying;
      if (!this.IsReady || this.IsHost || this.CurrentPlayerType != PlayerType.External) {
        return;
      }
      if (isplaying) {
        startPlayback(() => this.html5player.play());
      } else {
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
        // Tearing this component down raises pause, so without the player-type check an outgoing player
        // announces a state change and a position for the video that replaced it.
        if (this.CurrentPlayerType != PlayerType.External) {
          return;
        }
        this.playerService.PlayPause(true, this.UniqueId);
        // Publish the exact frame the host stopped or resumed on. No timeupdate fires while paused,
        // so without this every viewer sits wherever the last cadence tick left them, up to a
        // second away, and nothing arrives afterwards to correct it.
        this.mediaService.playerTimeImmediate.next(this.html5player.currentTime);
      } else {
        if (!this.IsPlaying && this.CurrentPlayerType == PlayerType.External) {
          this.html5player.pause();
        }
      }
    });
    this.html5player.addEventListener("pause", event => {
      if (this.IsHost) {
        // Tearing this component down raises pause, so without the player-type check an outgoing player
        // announces a state change and a position for the video that replaced it.
        if (this.CurrentPlayerType != PlayerType.External) {
          return;
        }
        this.playerService.PlayPause(false, this.UniqueId);
        // Publish the exact frame the host stopped or resumed on. No timeupdate fires while paused,
        // so without this every viewer sits wherever the last cadence tick left them, up to a
        // second away, and nothing arrives afterwards to correct it.
        this.mediaService.playerTimeImmediate.next(this.html5player.currentTime);
      } else {
        if (this.IsPlaying && this.CurrentPlayerType == PlayerType.External) {
          startPlayback(() => this.html5player.play());
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
