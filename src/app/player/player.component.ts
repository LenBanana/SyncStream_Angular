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
import {
  Subject
} from 'rxjs';
import {
  PingService
} from '../services/pingservice.service';
import {
  SignalRService
} from '../services/signal-r.service';
import {
  ReadVarExpr
} from '@angular/compiler';
declare var $: any

export var player: Plyr;

@Component({
  selector: 'app-player',
  templateUrl: './player.component.html',
  styleUrls: ['./player.component.scss']
})
export class PlayerComponent implements OnInit, OnDestroy, AfterViewInit {

  constructor(public playerService: PlayerService, public playlistService: PlaylistService, public signalrService: SignalRService, private _pingService: PingService) {}

  @Input() nav: boolean;
  @Input() logout: boolean;
  @Input() fullscreen: boolean;
  @Input() IsHost: boolean;
  @Input() UniqueId: string;
  @Input() currentTime: number;
  @Input() Threshhold: number = 0.5;
  @Input() twitchChat = false;
  @Input() Username = "";
  @Output() isPlayingEvent = new EventEmitter();
  @Output() playlistChange = new EventEmitter();
  @Output() toggleChat = new EventEmitter();
  @Output() threshholdChange = new EventEmitter();
  GallowWord = "";
  playingGallows;

  YTPlayer: YT.Player;
  readyEvent: Subject < void > = new Subject < void > ();
  CurrentPlayerType: PlayerType = PlayerType.Nothing;
  LastPlayerType: PlayerType = PlayerType.Nothing;
  Playlist: VideoDTO[] = [];
  CurrentVideo: VideoDTO;
  playerType = PlayerType;
  lastTime: number = 0;
  IsPlaying: boolean = false;
  TimeUpdate: any;
  playlistUpdate;
  pingUpdate;
  playerUpdate;
  isPlayingUpdate;
  timeUpdate;
  twitchChannel = "";
  twitchVOD = "";
  file: File;
  currentKey = "";
  currentVimeoKey = "";
  LastAddedExternalSource = "";
  LatestGuess = "";
  Init = false;
  CurrentPing = 0;
  PingInterval;

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
    clearInterval(this.PingInterval);
    this.removeListener();
  }

  ngOnInit(): void {
    this.PingInterval = setInterval(() => {
      this._pingService.GetPing();
      if (this.IsPlaying) {}
    }, 5000);
    this.addListener();
    if (( < any > window).onYouTubePlayerAPIReady!=undefined) {
      this.setInit();
      return;
    }
    if (typeof (YT) == 'undefined' || typeof (YT.Player) == 'undefined') {
      var tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      var firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }
    ( < any > window).onYouTubePlayerAPIReady = () => {
      this.setInit();
    };
    
  }

  setInit() {
    const YTElement = document.getElementById('YTPlayer');
    this.YTPlayer = new YT.Player(YTElement, {
      events: {
        onReady: () => {
          this.Init = true;
          this.readyEvent.next();
          this.TimeUpdate = setInterval(() => {
            var playerState = this.YTPlayer.getPlayerState();
            if (!this.IsHost) {
              if (this.IsPlaying && playerState == YT.PlayerState.PAUSED) {
                this.playerPlay(true);
              } else if (!this.IsPlaying && playerState == YT.PlayerState.PLAYING) {
                this.playerPause(true);
              }
              return;
            }
            if (playerState != YT.PlayerState.PAUSED) {
              const ytTime = this.YTPlayer.getCurrentTime();
              if (ytTime && ytTime > 0) {
                this.SetTime(this.YTPlayer.getCurrentTime());
              }
            }
          }, 250);
        },
        onStateChange: (event) => {
          this.YTStateChange(event);
        }
      },
      width: '100%',
      height: '100%'
    });
  }

  addListener() {
    this.playlistUpdate = this.playlistService.playlist.subscribe(result => {
      if (!result) {
        return;
      }
      this.Playlist = result;
      if (result && result.length > 0) {
        this.CurrentVideo = result[0];
      }
    });
    this.pingUpdate = this.signalrService.pingStream.subscribe(ping => {
      if (!ping) {
        return;
      }
      this.CurrentPing = Number.parseFloat(ping.toFixed(2));
      if (this.Threshhold < this.CurrentPing || (this.IsHost && this.Threshhold > 2 && this.CurrentPing < 2) || (!this.IsHost && this.Threshhold > .5 && this.CurrentPing < .5)) {
        if (!this.IsHost) {
          this.Threshhold = this.CurrentPing < .5 ? .5 : Number.parseFloat(ping.toFixed(2));
        } else {
          this.Threshhold = (this.CurrentPing < 2 ? 2 : Number.parseFloat(ping.toFixed(2))) * 2;
        }
        this.threshholdChange.emit(this.Threshhold);
      }
    });
    this.playingGallows = this.playerService.playingGallows.subscribe(playGallows => {
      if (playGallows == null || !playGallows) {
        return;
      }
      if (playGallows == "$clearboard$") {
        this.DrawWhiteboard(false);
        return;
      }
      this.GallowWord = playGallows;
      this.DrawWhiteboard(true);
    });
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
      this.isPlayingEvent.emit(isplaying);
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
            this.YTPlayer.seekTo(currentTime + this.CurrentPing, true);
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
    this.playerUpdate.unsubscribe();
    this.isPlayingUpdate.unsubscribe();
    this.timeUpdate.unsubscribe();
    this.playingGallows.unsubscribe();
    this.playlistUpdate.unsubscribe();
    this.pingUpdate.unsubscribe();
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
        this.playerPause(false);
        break;
      case YT.PlayerState.PLAYING:
        this.playerPlay(false);
        break;
      case YT.PlayerState.ENDED:
        if (!this.IsHost) {
          return;
        }
        this.playlistService.nextVideo(this.UniqueId);
        break;
    }
  }

  playPauseTwitch(playing: boolean) {
    this.IsPlaying = playing;
    this.isPlayingEvent.emit(playing);
    if (this.IsHost) {
      this.playerService.PlayPause(playing, this.UniqueId);
    }
  }

  playerPlay(forcePlay) {
    if (forcePlay && this.YTPlayer && this.YTPlayer.playVideo) {
      this.YTPlayer.playVideo();
      player.play();
    }
    if (!this.IsHost && this.IsPlaying === false) {
      if (this.CurrentPlayerType == PlayerType.YouTube) {
        this.YTPlayer.pauseVideo();
      } else {
        player.pause();
      }
    }
    if (this.IsHost) {
      this.playerService.PlayPause(true, this.UniqueId);
    }
  }

  playerPause(forcePause) {
    if (forcePause && this.YTPlayer && this.YTPlayer.pauseVideo) {
      this.YTPlayer.pauseVideo();
      player.pause();
    }
    if (!this.IsHost && this.IsPlaying === true) {
      if (this.CurrentPlayerType == PlayerType.YouTube) {
        this.YTPlayer.playVideo();
      } else {
        player.play();
      }
    }
    if (this.IsHost) {
      this.playerService.PlayPause(false, this.UniqueId);
    }
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
        if (this.IsPlaying && player.paused) {
          this.playerPlay(true);
        } else if (!this.IsPlaying && player.playing) {
          this.playerPause(true);
        }
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
    $('#dialogModal-Sync').modal('hide');
    this.twitchChannel = undefined;
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
      const key = keys[keys.length - 1];
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
    this.CurrentPlayerType = PlayerType.External;
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
      }, 500);
      return;
    }
    if (!key || !key.url || key.url.length == 0) {
      if (this.CurrentPlayerType != PlayerType.WhiteBoard) {
        this.CurrentPlayerType = PlayerType.Nothing;
        setTimeout(() => {
          this.YTPlayer.pauseVideo();
          player.pause();
        }, 100);
      }
      return;
    }
    this.currentKey = key.url;
    if (key.url.includes('youtube') || key.url.includes('youtu.be')) {
      if (this.CurrentPlayerType != PlayerType.WhiteBoard) {
        this.CurrentPlayerType = PlayerType.YouTube;
      }
      this.YTPlayer.loadVideoById(this.youtube_parser(key.url), time, 'hd1080');
      setTimeout(() => {
        player.pause();
      }, 100);
      return;
    }
    if (key.url.includes('vimeo.com')) {
      if (this.CurrentPlayerType != PlayerType.WhiteBoard) {
        this.CurrentPlayerType = PlayerType.Vimeo;
      }
      setTimeout(() => {
        this.YTPlayer.pauseVideo();
        player.pause();
      }, 100);
      this.setVideo(key.url);
      return;
    }
    if (!key.url.includes('twitch.tv') && key.url.startsWith('http')) {
      if (this.CurrentPlayerType != PlayerType.WhiteBoard) {
        this.CurrentPlayerType = PlayerType.External;
      }
      setTimeout(() => {
        this.YTPlayer.pauseVideo();
      }, 100);
      this.setVideo(key.url);
      return;
    }
    if (this.CurrentPlayerType != PlayerType.WhiteBoard) {
      this.CurrentPlayerType = PlayerType.Twitch;
    }
    if (key.title.startsWith("v")) {
      this.twitchVOD = key.title;
      this.twitchChannel = undefined;
    } else {
      this.twitchChannel = key.title;
      this.twitchVOD = undefined;
    }
    setTimeout(() => {
      this.YTPlayer.pauseVideo();
      player.pause();
    }, 100);
  }

  public async PlayURL() {
    var videourl = document.getElementById('videoinput') as HTMLInputElement;
    if (!videourl.value.startsWith('https://') && !videourl.value.startsWith('http://') && !videourl.value.startsWith('blob')) {
      var filebtn = document.getElementById('playerFileBtn') as HTMLButtonElement;
      if (!filebtn) {
        return;
      }
      filebtn.click();
      return;
    }
    this.currentKey = videourl.value;
    if (videourl.value.includes('youtube') || videourl.value.includes('youtu.be') || videourl.value.includes('twitch.tv') || videourl.value.includes('vimeo.com')) {
      var videoTitle = videourl.value.includes('vimeo.com') ? 'Vimeo - Video' : '';
      if (videourl.value.includes('youtube') || videourl.value.includes('youtu.be')) {
        try {
          var videoInfo = await this.playerService.GetYTTitle(videourl.value);
          videoTitle = videoInfo["title"];
        } catch (error) {
          videoTitle = '';
        }
      }
      var ytVid: VideoDTO = {
        url: videourl.value,
        title: videoTitle
      };
      this.playlistService.addVideo(ytVid, this.UniqueId);
    } else {
      this.LastAddedExternalSource = videourl.value;
      $('#dialogModal-Sync').modal('show');
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
      $('#dialogModal-Sync').modal('hide');
    }, 10);
  }

  private async SetTime(currentTime: number) {
    if ((currentTime > (this.lastTime + this.Threshhold) || currentTime < (this.lastTime - this.Threshhold))) {
      this.lastTime = currentTime;
      await this.playerService.SetTime(currentTime, this.UniqueId);
    }
  }

  public DrawWhiteboard(activate: boolean) {
    if (activate == true) {
      var chat = this.twitchChat;
      if (!chat) {
        this.toggleChat.emit();
      }
      this.LastPlayerType = this.CurrentPlayerType;
      this.CurrentPlayerType = PlayerType.WhiteBoard;
      if (this.IsHost) {
        this.playerService.PlayPause(false, this.UniqueId);
      }
      this.playerPause(true);
    } else {
      if (this.Playlist.length > 0) {
        if (this.CurrentVideo.url.includes('youtube') || this.CurrentVideo.url.includes('youtu.be')) {
          this.CurrentPlayerType = PlayerType.YouTube;
          return;
        }
        if (this.CurrentVideo.url.includes('vimeo.com')) {
          this.CurrentPlayerType = PlayerType.Vimeo;
          return;
        }
        if (this.CurrentVideo.url.includes('twitch.tv') && this.CurrentVideo.url.startsWith('http')) {
          this.CurrentPlayerType = PlayerType.Twitch;
          return;
        }
        this.CurrentPlayerType = PlayerType.External;
      } else {
        this.CurrentPlayerType = PlayerType.Nothing;
        return;
      }
    }
  }

  public WhiteBoardGuess(event) {
    this.LatestGuess = event;
  }

}

export enum PlayerType {
  Nothing,
  YouTube,
  Twitch,
  Vimeo,
  External,
  WhiteBoard
}
