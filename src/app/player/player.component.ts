import {
  Component,
  OnInit,
  Input,
  AfterViewChecked,
  OnDestroy,
  AfterViewInit,
  EventEmitter,
  Output,
  OnChanges
} from '@angular/core';
import * as Plyr from 'plyr';
import {
  PlayerService
} from './player-service/player.service';
import {
  PlaylistService
} from '../playlist/playlist-service/playlist.service';
import {
  VideoDTO
} from '../Interfaces/VideoDTO';
import $ from 'jquery';
import {
  Subject
} from 'rxjs';

export var player: Plyr;

@Component({
  selector: 'app-player',
  templateUrl: './player.component.html',
  styleUrls: ['./player.component.scss']
})
export class PlayerComponent implements OnInit, OnDestroy, AfterViewInit {

  constructor(public playerService: PlayerService, public playlistService: PlaylistService) {}

  @Input() nav: boolean;
  @Input() fullscreen: boolean;
  @Input() IsHost: boolean;
  @Input() UniqueId: string;
  @Input() currentTime: number;
  @Input() Threshhold: number = 0.5;
  @Input() twitchChat = false;
  @Input() Username = "";
  @Output() isPlaying = new EventEmitter();
  @Output() playlistChange = new EventEmitter();
  YTPlayer: YT.Player;
  readyEvent: Subject < void > = new Subject < void > ();
  CurrentPlayerType: PlayerType = PlayerType.Nothing;
  playerType = PlayerType;
  lastTime: number = 0;
  IsPlaying: boolean = false;
  TimeUpdate: any;
  playerUpdate;
  isPlayingUpdate;
  timeUpdate;
  twitchChannel = "";
  file: File;
  currentKey = "";
  currentVimeoKey = "";
  LastAddedExternalSource = "";
  SyncVideo = false;
  Init = false;

  ngAfterViewInit(): void {
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

  ngOnDestroy() {
    clearInterval(this.TimeUpdate);
    this.removeListener();
  }

  ngOnInit(): void {
    this.addListener();
    if (typeof (YT) == 'undefined' || typeof (YT.Player) == 'undefined') {
      var tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      var firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
    ( < any > window).onYouTubePlayerAPIReady = () => {
      const YTElement = document.getElementById('YTPlayer');
      this.YTPlayer = new YT.Player(YTElement, {
        events: {
          onReady: () => {
            this.Init = true;
            this.readyEvent.next();
            this.TimeUpdate = setInterval(() => {
              if (!this.IsHost) {
                return;
              }
              if (this.YTPlayer.getPlayerState() != YT.PlayerState.PAUSED) {
                const ytTime = this.YTPlayer.getCurrentTime();
                if (ytTime && ytTime>0) {
                  this.SetTime(this.YTPlayer.getCurrentTime());
                }
              }
            }, 100);
          },
          onStateChange: (event) => {
            this.YTStateChange(event);
          }
        },
        width: '100%',
        height: '100%'
      });
    };
  }

  addListener() {
    this.playerService.addPlayerListener();
    this.playerService.addPauseListener();
    this.playerService.addTimeListener();
    this.playerUpdate = this.playerService.player.subscribe(event => {
      if (!this.YTPlayer) {
        return;
      }
      if (!event || !event.url) {
        return;
      }
      this.setVideoDTO(event, 0);
    });
    this.isPlayingUpdate = this.playerService.isplaying.subscribe(isplaying => {
      this.IsPlaying = isplaying;
      this.isPlaying.emit(isplaying);
      if (!this.YTPlayer || !player) {
        return;
      }
      if (isplaying && !this.IsHost) {
        if (this.CurrentPlayerType == PlayerType.YouTube) {
          this.YTPlayer.playVideo();
        } else {
          player.play();
        }
      } else if (!isplaying && !this.IsHost) {
        if (this.CurrentPlayerType == PlayerType.YouTube) {
          this.YTPlayer.pauseVideo();
        } else {
          player.pause();
        }
      }
    });
    this.timeUpdate = this.playerService.currentTime.subscribe(currentTime => {
      if (!this.YTPlayer || !player) {
        return;
      }
      if (!this.IsHost) {
        if (this.CurrentPlayerType == PlayerType.YouTube) {
          let playerTime = 0;
          if (player.playing) {
            player.pause();
          }
          try {
            playerTime = this.YTPlayer.getCurrentTime();
          } catch {
            return;
          }
          if ((currentTime > (playerTime + this.Threshhold) || currentTime < (playerTime - this.Threshhold))) {
            if (this.YTPlayer.getPlayerState() == YT.PlayerState.PAUSED) {
              this.YTPlayer.playVideo();
            }
            this.YTPlayer.seekTo(currentTime, true);
          }
        } else {
          let playerTime = 0;
          try {
            playerTime = player.currentTime;
          } catch {
            return;
          }
          if ((currentTime > (playerTime + this.Threshhold) || currentTime < (playerTime - this.Threshhold))) {
            if (player.paused) {
              player.play();
            }
            player.currentTime = currentTime;
          }
        }

      }
    });
  }

  removeListener() {
    this.playerService.removePlayerListener();
    this.playerService.removePauseListener();
    this.playerService.removeTimeListener();
    this.playerUpdate.unsubscribe();
    this.isPlayingUpdate.unsubscribe();
    this.timeUpdate.unsubscribe();
  }

  fileChange(file) {
    if (!file || !file.target || !file.target.files) {
      return;
    }
    var url = window.URL.createObjectURL(file.target.files[0]);
    this.CurrentPlayerType = PlayerType.External;
    this.YTPlayer.pauseVideo();
    this.setVideo(url);
  }

  YTStateChange(event) {
    const state = event.data as YT.PlayerState;
    switch (state) {
      case YT.PlayerState.PAUSED:
        this.playerPause(true);
        break;
      case YT.PlayerState.PLAYING:
        this.playerPlay(true);
        break;
      case YT.PlayerState.ENDED:
        if (!this.IsHost) {
          return;
        }
        this.playlistService.nextVideo(this.UniqueId);
        break;
    }
  }

  playerPlay(IsYT: boolean) {
    if (!this.IsHost && this.IsPlaying === false) {
      if (IsYT) {
        this.YTPlayer.pauseVideo();
      } else {
        player.pause();
      }
    }
    if (!this.IsHost) {
      return;
    }
    this.playerService.PlayPause(true, this.UniqueId);
  }

  playerPause(IsYT: boolean) {
    if (!this.IsHost && this.IsPlaying === true) {
      if (IsYT) {
        this.YTPlayer.playVideo();
      } else {
        player.play();
      }
    }
    if (!this.IsHost) {
      return;
    }
    this.playerService.PlayPause(false, this.UniqueId);
  }

  InitPlayer() {
    player.on("play", event => {
      this.playerPlay(false);
    });
    player.on("pause", event => {
      this.playerPause(false);
    });
    player.on("timeupdate", timeupdated => {
      if (!this.IsHost) {
        return;
      }
      const currentTime: number = timeupdated.detail.plyr.currentTime;
      this.SetTime(currentTime);
    });
    player.on("ended", end => {
      if (!this.IsHost) {
        return;
      }
      //this.playlistService.nextVideo(this.UniqueId);
    });
  }

  setVideo(url: string) {
    this.SyncVideo = false;    
    this.twitchChannel = "";
    if (url.includes(".m3u8")) {
      player.source = {
        type: 'video',
        sources: [{
          src: url,
          type: 'application/x-mpegURL',
        }],
      };
      return;
    }
    if (url.includes('vimeo.com')) {
      const keys = url.split('/');
      const key = keys[keys.length-1];
      this.CurrentPlayerType = PlayerType.Vimeo;
      player.source = {
        type: 'video',
        sources: [{
          src: key,
          provider: 'vimeo',
        }],
      };
      return;
    }
    player.source = {
      type: 'video',
      sources: [{
        src: url,
        type: 'video/mp4',
      }],
    };
  }

  youtube_parser(url) {
    var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    var match = url.match(regExp);
    return (match && match[7].length == 11) ? match[7] : false;
  }

  setVideoDTO(key: VideoDTO, time: number) {
    if (!this.Init) {
      setTimeout(() => {
        this.setVideoDTO(key, time);
      }, 100);
      return;
    }
    if (!key || !key.url || key.url.length == 0) {
      return;
    }
    this.currentKey = key.url;
    if (key.url.includes('youtube') || key.url.includes('youtu.be')) {
      this.CurrentPlayerType = PlayerType.YouTube;
      console.log(this.CurrentPlayerType);
      this.YTPlayer.loadVideoById(this.youtube_parser(key.url), time, 'hd1080');
      setTimeout(() => {      
        player.pause();
        }, 100);
      return;
    }
    if (key.url.includes('vimeo.com')) {
      this.CurrentPlayerType = PlayerType.Vimeo;
      setTimeout(() => {      
        this.YTPlayer.pauseVideo();
        player.pause();
        }, 100);
      this.setVideo(key.url);
      return;
    }
    if (!key.url.includes('twitch.tv') && key.url.startsWith('http')) {
      this.CurrentPlayerType = PlayerType.External;
      setTimeout(() => {      
        this.YTPlayer.pauseVideo();
        }, 100);
      this.setVideo(key.url);
      return;
    }
    this.CurrentPlayerType = PlayerType.Twitch;
    this.twitchChannel = key.title;
    setTimeout(() => {      
    this.YTPlayer.pauseVideo();
    player.pause();
    }, 100);
  }

  public async PlayURL() {
    var videourl = document.getElementById('videoinput') as HTMLInputElement;
    if (!videourl.value.startsWith('https://') && !videourl.value.startsWith('http://') && !videourl.value.startsWith('blob'))
      return;
    this.currentKey = videourl.value;
    if (videourl.value.includes('youtube') || videourl.value.includes('youtu.be')) {
      var ytVid: VideoDTO = {
        url: videourl.value,
        title: ''
      };
      this.playlistService.addVideo(ytVid, this.UniqueId);
    } else if (videourl.value.includes('twitch.tv')) {
      var ytVid: VideoDTO = {
        url: videourl.value,
        title: ''
      };
      this.playlistService.addVideo(ytVid, this.UniqueId);
    } else if (videourl.value.includes('vimeo.com')) {
      var ytVid: VideoDTO = {
        url: videourl.value,
        title: 'Vimeo - Video'
      };
      this.playlistService.addVideo(ytVid, this.UniqueId);
    } else {
      this.LastAddedExternalSource = videourl.value;
      this.SyncVideo = true;
    }
    videourl.value = '';
    videourl.blur();
  }

  PlayExternalVideo(Title: string) {
    var ytVid: VideoDTO = {
      url: this.LastAddedExternalSource,
      title: Title
    };
    this.playlistService.addVideo(ytVid, this.UniqueId);
    setTimeout(() => {
      this.LastAddedExternalSource = "";
      this.SyncVideo = false;
    }, 10);
  }

  private async SetTime(currentTime: number) {
    if ((currentTime > (this.lastTime + this.Threshhold) || currentTime < (this.lastTime - this.Threshhold))) {
      this.lastTime = currentTime;
      await this.playerService.SetTime(currentTime, this.UniqueId);
    }
  }

}

export enum PlayerType {
  Nothing,
  YouTube,
  Twitch,
  Vimeo,
  External
}
