import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { VideoDTO } from '../Interfaces/VideoDTO';
import { PlayerService } from '../player/player-service/player.service';
import { PlayerType } from '../player/player.component';
import { PlaylistService } from '../playlist/playlist-service/playlist.service';
import { PingService } from '../services/pingservice.service';
import { SignalRService } from '../services/signal-r.service';
import { MediaService } from './media-service/media.service';

@Component({
  selector: 'app-media',
  templateUrl: './media.component.html',
  styleUrls: ['./media.component.scss']
})
export class MediaComponent implements OnInit, OnDestroy {

  constructor(private playerService: PlayerService, private playlistService: PlaylistService, private mediaService: MediaService, private pingService: PingService, private signalrService: SignalRService) { }
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
  PingInterval: NodeJS.Timeout;

  ngOnDestroy() {
    this.PlayerTypeListener.unsubscribe();
    this.IsPlayingListener.unsubscribe();
    this.PlaylistUpdate.unsubscribe();
    this.PlayerTimeListener.unsubscribe();
    this.PingUpdate.unsubscribe();
    clearInterval(this.PingInterval);
  }

  ngOnInit(): void {
    this.PingInterval = setInterval(() => {
      this.pingService.GetPing();
    }, 5000);
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
    this.PlayerTypeListener = this.playerService.playerType.subscribe(type => {
      if (!type || type == null) {
        this.CurrentPlayerType = PlayerType.Nothing;
        this.hideChat.emit(false);
        return;
      }
      this.CurrentPlayerType = type as PlayerType;
      if (this.CurrentPlayerType == PlayerType.Blackjack) {
        this.hideChat.emit(true);
      } else {
        this.hideChat.emit(false);
      }
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
