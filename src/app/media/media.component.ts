import {Component, EventEmitter, Input, OnDestroy, OnInit, Output} from '@angular/core';
import {Subject, Subscription} from 'rxjs';
import {VideoDTO} from '../Interfaces/VideoDTO';
import {PlayerService} from '../player/player-service/player.service';
import {PlayerType} from '../player/player.component';
import {PlaylistService} from '../playlist/playlist-service/playlist.service';
import {PingService} from '../services/pingservice.service';
import {SignalRService} from '../services/signal-r.service';
import {MediaService} from './media-service/media.service';
import {delay} from '../helper/generic';
import {WebrtcService} from "./webrtc/webrtc-service/webrtc.service";

declare var $: any;

@Component({
  selector: 'app-media',
  templateUrl: './media.component.html',
  styleUrls: ['./media.component.scss']
})
export class MediaComponent implements OnInit, OnDestroy {

  constructor(private playerService: PlayerService,
              private playlistService: PlaylistService,
              private mediaService: MediaService,
              private pingService: PingService,
              private signalrService: SignalRService,
              private webRtcService: WebrtcService
  ) {
  }

  @Input() UniqueId: string;
  @Input() logout: boolean;
  @Input() Username = "";
  @Input() IsHost: boolean;
  @Input() twitchChat = false;
  @Input() Threshhold = .5;
  @Output() isPlayingEvent = new EventEmitter();
  @Output() playlistChange = new EventEmitter();
  @Output() threshholdChange = new EventEmitter();
  @Output() hideChat = new EventEmitter();
  CurrentPing = 0;
  readyEvent: Subject<void> = new Subject<void>();
  CurrentPlayerType: PlayerType = PlayerType.Nothing;
  PlayerType = PlayerType;
  Playlist: VideoDTO[] = [];
  CurrentlyPlaying: VideoDTO;
  LastTime: number = 0;

  PlayerTypeListener: Subscription;
  IsPlayingListener: Subscription;
  PlayerTimeListener: Subscription;
  PlaylistUpdate: Subscription;
  PingUpdate: Subscription;
  VideoUpdate: Subscription;
  PingInterval: NodeJS.Timeout;
  WebRtcStreamStart: Subscription;
  WebRtcStreamStop: Subscription;

  ngOnDestroy() {
    this.PlayerTypeListener.unsubscribe();
    this.IsPlayingListener.unsubscribe();
    this.PlaylistUpdate.unsubscribe();
    this.PlayerTimeListener.unsubscribe();
    this.PingUpdate.unsubscribe();
    this.VideoUpdate.unsubscribe();
    clearInterval(this.PingInterval);
  }

  ngOnInit(): void {
    this.PingInterval = setInterval(() => {
      this.pingService.GetPing();
    }, 5000);
    this.WebRtcStreamStart = this.webRtcService.streamStart.subscribe(o => {
      if (o) {
        this.CurrentPlayerType = PlayerType.WebRtc;
      }
    });
    this.WebRtcStreamStop = this.webRtcService.streamStop.subscribe(o => {
      if (o && this.CurrentPlayerType === PlayerType.WebRtc) {
        this.CurrentPlayerType = PlayerType.Nothing;
      }
    });
    this.PingUpdate = this.signalrService.pingStream.subscribe(ping => {
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
    this.PlayerTypeListener = this.playerService.playerType.subscribe(async type => {
      if (!type || type == null) {
        this.CurrentPlayerType = PlayerType.Nothing;
        this.hideChat.emit(false);
        return;
      }
      this.CurrentPlayerType = type as PlayerType;
      this.hideChat.emit(this.CurrentPlayerType === PlayerType.Blackjack);
    });
    this.IsPlayingListener = this.playerService.isplaying.subscribe(play => {
      if (play != null) {
        this.isPlayingEvent.emit(play);
      }
    })
    this.PlaylistUpdate = this.playlistService.playlist.subscribe(result => {
      if (!result) {
        return;
      }
      this.Playlist = result;
    });
    this.PlayerTimeListener = this.mediaService.playerTime.subscribe(t => {
      if (t > 0) {
        this.SetTime(t);
      }
    })
    this.VideoUpdate = this.playerService.player.subscribe(async vid => {
      if (vid) {
        $('#playerContainer').addClass('zoom-out');
        await delay(500)
        $('#playerContainer').addClass('zoom-in');
        await delay(150)
        $('#playerContainer').removeClass('zoom-out').removeClass('zoom-in');
      }
    });
  }

  nowPlaying(video: VideoDTO) {
    this.CurrentlyPlaying = video;
  }

  private async SetTime(currentTime: number) {
    if ((currentTime > (this.LastTime + this.Threshhold) || currentTime < (this.LastTime - this.Threshhold))) {
      this.LastTime = currentTime;
      this.playerService.SetTime(currentTime, this.UniqueId);
    }
  }
}
