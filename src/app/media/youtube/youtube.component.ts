import {
  AfterViewInit,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output
} from '@angular/core';
import { Subscription } from 'rxjs';
import { delay } from '../../helper/generic';
import {
  PlayerService
} from '../../player/player-service/player.service';
import {
  PlayerType
} from '../../player/player.component';
import {
  PlaylistService
} from '../../playlist/playlist-service/playlist.service';
import { MediaService } from '../media-service/media.service';

@Component({
  selector: 'app-youtube',
  templateUrl: './youtube.component.html',
  styleUrls: ['./youtube.component.scss']
})
export class YoutubeComponent implements OnInit, OnDestroy, OnChanges, AfterViewInit {
  constructor(private playlistService: PlaylistService, private playerService: PlayerService, private mediaService: MediaService) {}
  @Input() CurrentPlayerType = PlayerType.Nothing;
  @Input() IsHost = false;
  @Input() UniqueId = "";
  @Input() CurrentPing = 0;
  @Input() Threshhold = .5;
  @Output() PlayerReady = new EventEmitter();

  PlayerType = PlayerType;
  YTPlayer: YT.Player;
  TimeUpdate: NodeJS.Timeout;
  ServerTimeUpdate: Subscription
  IsPlayingUpdate: Subscription
  VideoUpdate: Subscription
  IsPlaying = false;
  IsYtReady = false;
  IsReady = false;

  ngOnDestroy() {
    clearInterval(this.TimeUpdate);
    this.IsPlayingUpdate?.unsubscribe();
    this.VideoUpdate?.unsubscribe();
    this.ServerTimeUpdate?.unsubscribe();
  }

  ngOnChanges() {
    if (this.CurrentPlayerType != PlayerType.YouTube) {
      if (this.YTPlayer) {
        this.YTPlayer.stopVideo();
      }
    }
  }

  ngAfterViewInit(): void {
    if (typeof (YT) == 'undefined' || typeof (YT.Player) == 'undefined') {
      var tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      var firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
    if (( < any > window).onYouTubePlayerAPIReady == undefined) {
      ( < any > window).onYouTubePlayerAPIReady = () => {
        this.setInit();
      };
    } else {
      this.setInit();
    }
  }

  ngOnInit(): void {
  }


  youtube_parser(url) {
    var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    var match = url.match(regExp);
    return (match && match[7].length == 11) ? match[7] : false;
  }

  setInit() {
    const YTElement = document.getElementById('YTPlayer');
    this.YTPlayer = new YT.Player(YTElement, {
      events: {
        onReady: () => {
          this.TimeUpdate = setInterval(() => {
            var playerState = this.YTPlayer.getPlayerState();
            if (this.CurrentPlayerType != PlayerType.YouTube) {
              if (playerState == YT.PlayerState.PLAYING) {
                this.YTPlayer.pauseVideo();
              }
              return;
            }
            if (!this.IsHost) {
              if (this.IsPlaying && playerState == YT.PlayerState.PAUSED) {
                this.YTPlayer.playVideo();
              } else if (!this.IsPlaying && playerState == YT.PlayerState.PLAYING) {
                this.YTPlayer.pauseVideo();
              }
              return;
            }
            if (playerState != YT.PlayerState.BUFFERING) {
              const ytTime = this.YTPlayer.getCurrentTime();
              if (ytTime && ytTime >= 0) {
                this.mediaService.playerTime.next(ytTime);
              }
            }
          }, 100)
            this.PlayerReady.emit();
          if (!this.IsReady) {
            this.IsReady = true;
            this.AddSubscriptions();
          }
        },
        onStateChange: (event) => {
          if (!this.IsHost) {
            return;
          }
          this.YTStateChange(event);
        },
      },
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: YT.AutoPlay.AutoPlay,
        enablejsapi: YT.JsApi.Enable,
        modestbranding: YT.ModestBranding.Modest,
        rel: YT.RelatedVideos.Hide,
        showinfo: YT.ShowInfo.Hide
      }
    });
  }

  AddSubscriptions() {
    //Time update from server
    this.ServerTimeUpdate = this.playerService.currentTime.subscribe(t => {
      if (!t || t == null || this.IsHost || this.CurrentPlayerType != PlayerType.YouTube || !this.IsReady) {
        return;
      }
      let playerTime = this.YTPlayer.getCurrentTime();
      var playerState = this.YTPlayer.getPlayerState();
      if (playerTime >= 0 && ((t > (playerTime + this.Threshhold) || t < (playerTime - this.Threshhold)))) {
        if (playerState != YT.PlayerState.BUFFERING) {
          this.YTPlayer.seekTo(t + this.CurrentPing, true);
        }
      }
    });
    //Play/Pause update from server
    this.IsPlayingUpdate = this.playerService.isplaying.subscribe(isplaying => {
      if (isplaying != null) {
        this.IsPlaying = isplaying;
      }
      if (!this.IsReady || this.IsHost || this.CurrentPlayerType != PlayerType.YouTube) {
        return;
      }
      if (isplaying) {
        this.YTPlayer.playVideo();
      } else if (!isplaying) {
        this.YTPlayer.pauseVideo();
      }
    });
    //Video update from server
    this.VideoUpdate = this.playerService.player.subscribe(async vid => {
      await delay(10);
      if (!this.IsReady|| this.CurrentPlayerType != PlayerType.YouTube || !vid) {
        return;
      }
      this.YTPlayer.loadVideoById(this.youtube_parser(vid.url), 0, 'hd1080');
    });
  }

  YTStateChange(event) {
    if (this.CurrentPlayerType != PlayerType.YouTube) {
      return;
    }
    const state = event.data as YT.PlayerState;
    switch (state) {
      case YT.PlayerState.PAUSED:
        this.playerService.PlayPause(false, this.UniqueId);
        break;
      case YT.PlayerState.PLAYING:
        this.playerService.PlayPause(true, this.UniqueId);
        break;
      case YT.PlayerState.ENDED:
        this.playlistService.nextVideo(this.UniqueId);
        break;
    }
  }
}
