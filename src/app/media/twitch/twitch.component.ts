import { AfterViewInit, Component, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { TwitchPlayer, TwitchPlayerEvent, TwitchPlayerOptions } from 'twitch-player';
import { delay } from '../../helper/generic';
import { PlayerService } from '../../player/player-service/player.service';
import { PlayerType } from '../../player/player.component';
import { PlaylistService } from '../../playlist/playlist-service/playlist.service';
import { MediaService } from '../media-service/media.service';
import { PlaybackSyncService } from '../../media/sync/playback-sync.service';
import { TwitchTarget } from '../../media/sync/playback-target';

@Component({
  selector: 'app-twitch',
  templateUrl: './twitch.component.html',
  styleUrls: ['./twitch.component.scss']
})
export class TwitchComponent implements OnInit, OnChanges, OnDestroy, AfterViewInit {

  constructor(private playerService: PlayerService, private mediaService: MediaService, private playlistService: PlaylistService, private playbackSync: PlaybackSyncService) { }
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
  player: TwitchPlayer;

  ngOnInit(): void {

  }

  ngAfterViewInit(): void {
    this.player = TwitchPlayer.FromOptions('twitchMediaPlayer', {
      height: '100%',
      width: '100%',
      channel: '',
      autoplay: true,
      muted: false
    });
    this.AddEventListener();
  }

  AddEventListener() {
    this.player.addEventListener(TwitchPlayerEvent.PLAY, () => {
      if (this.IsHost) {
        this.playerService.PlayPause(true, this.UniqueId);
        // Publish the exact frame the host stopped or resumed on. No timeupdate fires while paused, so
        // without this every viewer sits wherever the last cadence tick left them, up to a second away,
        // and nothing arrives afterwards to correct it. Guarded on the player type because tearing this
        // component down raises pause, and an outgoing player must not publish a position for the video
        // that replaced it.
        if (this.CurrentPlayerType == PlayerType.Twitch) {
          this.mediaService.playerTimeImmediate.next(this.player.getCurrentTime());
        }
      } else {
        if (!this.IsPlaying && (this.CurrentPlayerType == PlayerType.External || this.CurrentPlayerType == PlayerType.Vimeo)) {
          this.player.pause();
        }
      }
    });
    this.player.addEventListener(TwitchPlayerEvent.PAUSE, () => {
      if (this.IsHost) {
        this.playerService.PlayPause(false, this.UniqueId);
        // Publish the exact frame the host stopped or resumed on. No timeupdate fires while paused, so
        // without this every viewer sits wherever the last cadence tick left them, up to a second away,
        // and nothing arrives afterwards to correct it. Guarded on the player type because tearing this
        // component down raises pause, and an outgoing player must not publish a position for the video
        // that replaced it.
        if (this.CurrentPlayerType == PlayerType.Twitch) {
          this.mediaService.playerTimeImmediate.next(this.player.getCurrentTime());
        }
      } else {
        if (this.IsPlaying && (this.CurrentPlayerType == PlayerType.External || this.CurrentPlayerType == PlayerType.Vimeo)) {
          this.player.play();
        }
      }
    });
    this.player.addEventListener(TwitchPlayerEvent.READY, () => {
      if (!this.IsReady) {
        this.IsReady = true;
        this.AddSubscriptions();
      }
      this.TimeUpdate = setInterval(() => {
        if (this.CurrentPlayerType != PlayerType.Twitch) {
          if (this.player.isPaused() == false) {
            this.player.pause();
          }
          return;
        }
        if (!this.IsHost) {
          if (this.IsPlaying && this.player.isPaused()) {
            this.player.play();
          } else if (!this.IsPlaying && this.player.isPaused() == false) {
            this.player.pause();
          }
          return;
        }
        const time = this.player.getCurrentTime();
        if (time && time >= 0 && this.player.isPaused() == false) {
          this.mediaService.playerTime.next(time);
        }
      }, 100)
    });
    this.player.addEventListener(TwitchPlayerEvent.ENDED, () => {
      if (!this.IsHost) {
        return;
      }
      this.playlistService.nextVideo(this.UniqueId);
    });
  }

  ngOnChanges() {
    if (this.IsReady && this.CurrentPlayerType != PlayerType.Twitch) {
      this.player.pause();
    }
  }

  ngOnDestroy() {
    this.IsPlayingUpdate?.unsubscribe();
    this.VideoUpdate?.unsubscribe();
    this.ServerTimeUpdate?.unsubscribe();
    clearInterval(this.TimeUpdate);
    this.player = null;
  }

  AddSubscriptions() {
    //Time update from server
    this.ServerTimeUpdate = this.playerService.currentTime.subscribe(sync => {
      if (!this.IsReady || !sync || this.IsHost || this.CurrentPlayerType != PlayerType.Twitch) {
        return;
      }
      this.playbackSync.apply(new TwitchTarget(this.player), sync);
    });
    //Play/Pause update from server
    this.IsPlayingUpdate = this.playerService.isplaying.subscribe(isplaying => {
      if (isplaying != null) {
        this.IsPlaying = isplaying;
      }
      if (this.IsHost || this.CurrentPlayerType != PlayerType.Twitch) {
        return;
      }
      if (!this.IsReady) {
        return;
      }
      if (isplaying) {
        this.player.play();
      } else if (!isplaying) {
        this.player.pause();
      }
    });
    //Video update from server
    this.VideoUpdate = this.playerService.player.subscribe(async vid => {
      await delay(10);
      if (this.CurrentPlayerType != PlayerType.Twitch || !vid) {
        return;
      }
      const twitchVodMatch = /^\d+$/.test(vid.url);
      console.log(vid.url);
      if (!twitchVodMatch) {
        this.player.setVideo(vid.url, 0);
      } else {
        this.player.setChannel(vid.title);
      }
    });
  }

}
