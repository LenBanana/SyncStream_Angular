import {AfterContentInit, Component, EventEmitter, Input, OnDestroy, OnInit, Output} from '@angular/core';
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
import {browserSettingName, BrowserSettings} from "../Interfaces/BrowserSettings";
import {WebrtcVoipService} from "./webrtc-voip/webrtc-voip-service/webrtc-voip.service";
import {DreckchatService} from "../dreckchat/dreckchat-service/dreckchat.service";
import {UserPrivileges} from "../user-admin-modal/user-admin-modal.component";

declare var $: any;

@Component({
  selector: 'app-media',
  templateUrl: './media.component.html',
  styleUrls: ['./media.component.scss']
})
export class MediaComponent implements OnInit, OnDestroy, AfterContentInit {

  constructor(private playerService: PlayerService,
              private playlistService: PlaylistService,
              private mediaService: MediaService,
              private pingService: PingService,
              private signalrService: SignalRService,
              private webRtcService: WebrtcService,
              private voipService: WebrtcVoipService,
              private chatService: DreckchatService
  ) {
  }

  @Input() UniqueId: string;
  @Input() Privileges: number;
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
  LastPlayerType: PlayerType = PlayerType.Nothing;
  PlayerType = PlayerType;
  Playlist: VideoDTO[] = [];
  CurrentlyPlaying: VideoDTO;
  LastTime: number = 0;
  Voip: boolean = false;

  Subscriptions: Subscription[] = [];
  PingInterval: NodeJS.Timeout;

  ngOnDestroy() {
    this.Subscriptions.forEach(s => s.unsubscribe());
    clearInterval(this.PingInterval);
  }

  async ngAfterContentInit() {
    this.fetchSettings();
  }

  ngOnInit(): void {
    this.PingInterval = setInterval(() => {
      this.pingService.GetPing();
    }, 5000);
    this.Subscriptions.push(this.webRtcService.streamStart.subscribe(o => {
        if (o) {
          this.LastPlayerType = this.CurrentPlayerType;
          this.CurrentPlayerType = PlayerType.WebRtc;
        }
      }),
      this.webRtcService.streamStop.subscribe(o => {
        if (o && this.CurrentPlayerType === PlayerType.WebRtc) {
          this.CurrentPlayerType = this.LastPlayerType;
        }
      }),
      this.signalrService.pingStream.subscribe(ping => {
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
      }),
      this.playerService.playerType.subscribe(async type => {
        if (!type) {
          this.CurrentPlayerType = PlayerType.Nothing;
          this.hideChat.emit(false);
          return;
        }
        if (this.CurrentPlayerType !== type) {
          this.LastPlayerType = this.CurrentPlayerType;
          this.CurrentPlayerType = type as PlayerType;
          this.hideChat.emit(this.CurrentPlayerType === PlayerType.Blackjack);
        }
      }),
      this.playerService.isplaying.subscribe(play => {
        if (play != null) {
          this.isPlayingEvent.emit(play);
        }
      }),
      this.playlistService.playlist.subscribe(result => {
        if (!result) {
          return;
        }
        this.Playlist = result;
      }),
      this.mediaService.playerTime.subscribe(t => {
        if (t > 0) {
          this.SetTime(t);
        }
      }),
      this.voipService.joinRoom.subscribe(result => {
        if (result == null) {
          return;
        }
        if (result == this.UniqueId) {
          this.Voip = true;
        }
      }),
      this.voipService.leaveRoom.subscribe(result => {
        if (result == null) {
          return;
        }
        if (result == this.UniqueId) {
          this.Voip = false;
        }
      }));
  }

  fetchSettings() {
    const itemBackup = localStorage.getItem(browserSettingName);
    const browserSettings = JSON.parse(itemBackup) as BrowserSettings;
    if (browserSettings && browserSettings.generalSettings.defaultVoip && !this.Voip) {
      this.chatService.joinVoice.next(this.UniqueId);
    }
  }

  nowPlaying(video: VideoDTO) {
    this.CurrentlyPlaying = video;
  }

  private SetTime(currentTime: number) {
    if ((currentTime > (this.LastTime + this.Threshhold) || currentTime < (this.LastTime - this.Threshhold))) {
      this.LastTime = currentTime;
      this.playerService.SetTime(currentTime, this.UniqueId);
    }
  }

  protected readonly UserPrivileges = UserPrivileges;
}
