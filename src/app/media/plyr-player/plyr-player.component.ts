import { AfterViewInit, Component, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import Plyr from 'plyr';
import { Subscription } from 'rxjs';

import { delay } from '../../helper/generic';
import { VideoDTO } from '../../Interfaces/VideoDTO';
import { PlayerService } from '../../player/player-service/player.service';
import { PlayerType } from '../../Interfaces/PlayerType';
import { PlaylistService } from '../../playlist/playlist-service/playlist.service';
import { baseUrl } from '../../services/signal-r.service';
import { MediaService } from '../media-service/media.service';
import { AlertType, Dialog } from '../../Interfaces/Dialog';
import { DialogService } from '../../text-dialog/text-dialog-service/dialog-service.service';
import { PlaybackSyncService } from '../../media/sync/playback-sync.service';
import { PlyrTarget } from '../../media/sync/playback-target';
import { startPlayback } from '../../media/sync/playback-start';
declare var $: any;
export var player: Plyr = undefined;
@Component({
  selector: 'app-plyr-player',
  templateUrl: './plyr-player.component.html',
  styleUrls: ['./plyr-player.component.scss']
})
export class PlyrPlayerComponent implements OnInit, AfterViewInit, OnDestroy, OnChanges {

  constructor(private playlistService: PlaylistService, private playerService: PlayerService, private mediaService: MediaService, private dialogService: DialogService, private playbackSync: PlaybackSyncService) { }
  @Input() CurrentPlayerType = PlayerType.Nothing;
  @Input() IsHost = false;
  @Input() UniqueId = "";
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

    // Destroyed and cleared, so the next mount builds its own.
    //
    // The instance lives in a module variable and was only created when that variable was still undefined, so
    // leaving it behind meant the next component to mount skipped InitPlayer entirely: it never attached its own
    // handlers, never called AddSubscriptions, and left IsReady false, so it did not follow the room's position
    // at all. Meanwhile the handlers from this component stayed attached to the shared instance and kept
    // reporting with whatever IsHost and CurrentPlayerType it had when it was torn down.
    //
    // The off calls this replaces removed nothing: each passed a freshly created function, and removing a
    // listener needs the same reference that was added.
    try {
      player?.destroy();
    } catch {
      // A player whose element has already gone is nothing to clean up.
    }
    player = undefined;
  }

  AddSubscriptions() {
    //Time update from server
    this.ServerTimeUpdate = this.playerService.currentTime.subscribe(sync => {
      if (!this.IsReady || !sync || this.IsHost || this.CurrentPlayerType != PlayerType.Vimeo) {
        return;
      }
      this.playbackSync.apply(new PlyrTarget(player), sync);
    });
    //Play/Pause update from server
    this.IsPlayingUpdate = this.playerService.isplaying.subscribe(isplaying => {
      // Null means the state is not known rather than not playing, and the subject is reset to it. Falling
      // through to the pause branch on it answers "no idea" by pausing.
      if (isplaying == null) {
        return;
      }
      this.IsPlaying = isplaying;
      if (!this.IsReady || this.IsHost || this.CurrentPlayerType != PlayerType.Vimeo) {
        return;
      }
      if (player.buffered > 0) {
        if (isplaying) {
          startPlayback(() => player.play());
        } else {
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
        // Tearing this component down raises pause, so without the player-type check an outgoing player
        // announces a state change and a position for the video that replaced it.
        if (this.CurrentPlayerType != PlayerType.Vimeo) {
          return;
        }
        this.playerService.PlayPause(true, this.UniqueId);
        // Publish the exact frame the host stopped or resumed on. No timeupdate fires while paused,
        // so without this every viewer sits wherever the last cadence tick left them, up to a
        // second away, and nothing arrives afterwards to correct it.
        this.mediaService.playerTimeImmediate.next(player.currentTime);
      } else {
        if (!this.IsPlaying && this.CurrentPlayerType == PlayerType.Vimeo) {
          player.pause();
        }
      }
    });
    player.on("pause", event => {
      if (this.IsHost) {
        // Tearing this component down raises pause, so without the player-type check an outgoing player
        // announces a state change and a position for the video that replaced it.
        if (this.CurrentPlayerType != PlayerType.Vimeo) {
          return;
        }
        this.playerService.PlayPause(false, this.UniqueId);
        // Publish the exact frame the host stopped or resumed on. No timeupdate fires while paused,
        // so without this every viewer sits wherever the last cadence tick left them, up to a
        // second away, and nothing arrives afterwards to correct it.
        this.mediaService.playerTimeImmediate.next(player.currentTime);
      } else {
        if (this.IsPlaying && this.CurrentPlayerType == PlayerType.Vimeo) {
          startPlayback(() => player.play());
        }
      }
    });
    player.on("seeked", () => {
      if (this.IsHost && this.CurrentPlayerType == PlayerType.Vimeo) {
        this.mediaService.playerTimeImmediate.next(player.currentTime);
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
