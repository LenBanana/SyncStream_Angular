import {AfterContentInit, Component, EventEmitter, Input, OnDestroy, OnInit, Output} from '@angular/core';
import {Subject, Subscription} from 'rxjs';
import {VideoDTO} from '../Interfaces/VideoDTO';
import {PlayerService} from '../player/player-service/player.service';
import { PlayerType } from '../Interfaces/PlayerType';
import {PlaylistService} from '../playlist/playlist-service/playlist.service';
import {PingService} from '../services/pingservice.service';
import {PlaybackSyncService} from './sync/playback-sync.service';
import {SignalRService} from '../services/signal-r.service';
import {MediaService} from './media-service/media.service';
import {delay} from '../helper/generic';
import {WebrtcService} from "./webrtc/webrtc-service/webrtc.service";
import {loadBrowserSettings} from "../Interfaces/BrowserSettings";
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
              public webRtcService: WebrtcService,
              private voipService: WebrtcVoipService,
              private chatService: DreckchatService,
              private playbackSync: PlaybackSyncService
  ) {
  }

  @Input() UniqueId: string;
  @Input() Privileges: number;
  @Input() logout: boolean;
  @Input() Username = "";
  @Input() IsHost: boolean;
  @Input() twitchChat = false;
  @Output() isPlayingEvent = new EventEmitter();
  @Output() playlistChange = new EventEmitter();
  @Output() hideChat = new EventEmitter();
  readyEvent: Subject<void> = new Subject<void>();
  CurrentPlayerType: PlayerType = PlayerType.Nothing;
  LastPlayerType: PlayerType = PlayerType.Nothing;
  PlayerType = PlayerType;
  Playlist: VideoDTO[] = [];
  CurrentlyPlaying: VideoDTO;
  LastTime: number = 0;
  private lastReportMs = 0;

  /** The source the sync service was last reset for. */
  private syncedSourceUrl: string | null = null;

  /** What the room believes about playback, so the host can notice when it disagrees with its own player. */
  private roomIsPlaying: boolean | null = null;

  /** How often the host reports its position while playing. */
  private static readonly reportIntervalMs = 1000;
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
    // Keeps PlaybackSyncService supplied with round-trip samples. Nothing here reads the ping itself; the
    // sync service takes the smallest of the recent ones to estimate how stale a host report is on arrival.
    // Measured at once as well as on the interval: waiting for the first tick left the first five seconds in a
    // room, which is exactly when a joining viewer is furthest out of step, with no measurement at all.
    this.pingService.GetPing();
    this.PingInterval = setInterval(() => {
      this.pingService.GetPing();
    }, 5000);
    this.Subscriptions.push(this.webRtcService.streamStart.subscribe(o => {
        // Do not switch to WebRtc mode if we are the file-share host — the SFU
        // send-transport for file sharing does not go through StartSfuStream and
        // should not affect the player type.
        if (o && !this.webRtcService.isFileShareHost) {
          this.LastPlayerType = this.CurrentPlayerType;
          this.CurrentPlayerType = PlayerType.WebRtc;
        }
      }),
      this.webRtcService.streamStop.subscribe(o => {
        if (o && this.CurrentPlayerType === PlayerType.WebRtc) {
          this.CurrentPlayerType = this.LastPlayerType;
        }
      }),
      // File share: side-nav emitted fileShareHostRequested — switch host to FileShare
      // player so the self-contained FileSharePlayerComponent can render and let the
      // user pick their file.  The component itself calls startFileShare after that.
      this.webRtcService.fileShareHostRequested.subscribe(() => {
        if (this.CurrentPlayerType !== PlayerType.FileShare) {
          this.LastPlayerType = this.CurrentPlayerType;
          this.CurrentPlayerType = PlayerType.FileShare;
        }
      }),
      // RTMP file share: side-nav emitted rtmpFileShareHostRequested — switch to RtmpFileShare player.
      this.webRtcService.rtmpFileShareHostRequested.subscribe(() => {
        if (this.CurrentPlayerType !== PlayerType.RtmpFileShare) {
          this.LastPlayerType = this.CurrentPlayerType;
          this.CurrentPlayerType = PlayerType.RtmpFileShare;
        }
      }),
      // RTMP file share: started by someone else in the room — switch to viewer.
      this.webRtcService.rtmpFileShareActive.subscribe(info => {
        if (info && !this.webRtcService.isRtmpFileShareHost && !this.webRtcService.isPreparingRtmpFileShareHost) {
          if (this.CurrentPlayerType !== PlayerType.RtmpFileShare) {
            this.LastPlayerType = this.CurrentPlayerType;
            this.CurrentPlayerType = PlayerType.RtmpFileShare;
          }
        }
        if (!info && this.CurrentPlayerType === PlayerType.RtmpFileShare) {
          this.CurrentPlayerType = this.LastPlayerType;
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
      this.playerService.player.subscribe(video => {
        // A new source is a new timeline, so the sync service must drop the quiet period it is holding from
        // the last correction on the old one. Without this the first correction on a newly started video can
        // be swallowed for up to the cooldown, which is exactly when a viewer is furthest out of step.
        const url = video ? video.url : null;
        if (url === this.syncedSourceUrl) {
          return;
        }
        this.syncedSourceUrl = url;
        this.playbackSync.reset();

        // Drop the last position along with it. The room's position is published through a BehaviorSubject, so
        // it hands its most recent value to whoever subscribes next, and a player component created for the new
        // video sets IsReady immediately before subscribing. It therefore received the previous video's position
        // and seeked the new one straight to it. Nulled here because null means "not known yet", which is the
        // truth between a video changing and the host reporting where it has reached, about a second later.
        this.playerService.currentTime.next(null);
      }),
      this.playerService.isplaying.subscribe(play => {
        if (play != null) {
          this.roomIsPlaying = play;
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
        // Position zero is a real position: rejecting it meant a host at the very start of a video, or one
        // that had just seeked back to it, reported nothing.
        if (t != null && t >= 0) {
          this.SetTime(t);
        }
      }),
      this.mediaService.playerTimeImmediate.subscribe(t => {
        if (t != null && t >= 0) {
          this.reportPositionNow(t);
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
    const browserSettings = loadBrowserSettings();
    if (browserSettings && browserSettings.generalSettings.defaultVoip && !this.Voip) {
      this.chatService.joinVoice.next(this.UniqueId);
    }
  }

  nowPlaying(video: VideoDTO) {
    this.CurrentlyPlaying = video;
  }

  /**
   * Records where the host has reached, at a steady rate.
   *
   * The host used to publish only once its position had moved further than a deadband derived from the ping,
   * which worked out to at least four seconds. So viewers got a fresh reference roughly every four seconds
   * of playback and had nothing to correct against in between, which is half the reason drift became visible
   * before anything fixed it. One report per second per room is nothing, and it means a viewer is never
   * working from a stale position.
   *
   * A seek, a play, a pause or a change of video reports immediately, so a scrub propagates at once instead
   * of waiting for the next tick.
   */
  private SetTime(currentTime: number, immediate = false) {
    if (!this.IsHost || typeof currentTime !== 'number' || !isFinite(currentTime)) {
      return;
    }

    const now = Date.now();
    if (!immediate && now - this.lastReportMs < MediaComponent.reportIntervalMs) {
      return;
    }

    const elapsedSeconds = (now - this.lastReportMs) / 1000;
    const advanced = currentTime - this.LastTime;

    this.lastReportMs = now;
    this.LastTime = currentTime;
    this.playerService.SetTime(currentTime, this.UniqueId, this.playbackSync.oneWayLatencySeconds);

    // The host's player is demonstrably running, so if the room still thinks nothing is playing, say so.
    //
    // Play and pause are announced by one-shot events, and the events can be lost. A source change suppresses
    // them so a programmatic load is not reported as somebody pressing play, and that suppression is lifted when
    // the player reports itself ready. In a background tab the YouTube frame defers and reorders those two, so
    // play arrives while still suppressed, is dropped, and never comes again: the host watches while everybody
    // else sits paused until the host presses pause and play by hand.
    //
    // Inferred from the position moving rather than from a report arriving, because a report can also come from
    // a seek while paused. Only cadence reports count, and only an advance that matches roughly real time, so a
    // jump is not mistaken for playback.
    if (!immediate
        && this.roomIsPlaying === false
        && advanced > 0.05
        && advanced <= Math.max(1, elapsedSeconds * 2)) {
      this.playerService.PlayPause(true, this.UniqueId);
    }
  }

  /** Reports the current position at once, for a seek or a play state change. */
  reportPositionNow(currentTime: number) {
    this.SetTime(currentTime, true);
  }

  protected readonly UserPrivileges = UserPrivileges;
}
