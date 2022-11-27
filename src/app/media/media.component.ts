import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { VideoDTO } from '../Interfaces/VideoDTO';
import { PlayerService } from '../player/player-service/player.service';
import { PlayerType } from '../player/player.component';
import { PlaylistService } from '../playlist/playlist-service/playlist.service';
import { MediaService } from './media-service/media.service';

@Component({
  selector: 'app-media',
  templateUrl: './media.component.html',
  styleUrls: ['./media.component.scss']
})
export class MediaComponent implements OnInit, OnDestroy {

  constructor(private playerService: PlayerService, private playlistService: PlaylistService, private mediaService: MediaService) { }
  @Input() UniqueId: string;
  @Input() logout: boolean;
  @Input() Username = "";
  @Input() IsHost: boolean;
  @Input() twitchChat = false;
  @Input() Threshhold = .5;
  @Output() isPlayingEvent = new EventEmitter();
  @Output() playlistChange = new EventEmitter();
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

  ngOnDestroy() {
    this.PlayerTypeListener.unsubscribe();
    this.IsPlayingListener.unsubscribe();
  }

  ngOnInit(): void {
    this.PlayerTypeListener = this.playerService.playerType.subscribe(type => {
      if (!type || type == null) {
        this.CurrentPlayerType = PlayerType.Nothing;
        return;
      }
      this.CurrentPlayerType = type as PlayerType;
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
