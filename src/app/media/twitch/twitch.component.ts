import { AfterViewInit, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { TwitchPlayer, TwitchPlayerEvent } from 'twitch-player';
import { PlayerService } from '../../player/player-service/player.service';
import { PlayerType } from '../../player/player.component';
import { PlaylistService } from '../../playlist/playlist-service/playlist.service';
import { PlaybackSyncService } from '../../media/sync/playback-sync.service';
import { TwitchTarget } from '../../media/sync/playback-target';
import { MediaService } from '../media-service/media.service';
import { TwitchSource, clipEmbedUrl, parseTwitchSource, toTwitchOffset } from './twitch-source';

@Component({
  selector: 'app-twitch',
  templateUrl: './twitch.component.html',
  styleUrls: ['./twitch.component.scss']
})
export class TwitchComponent implements AfterViewInit, OnChanges, OnDestroy {

  constructor(
    private playerService: PlayerService,
    private mediaService: MediaService,
    private playlistService: PlaylistService,
    private playbackSync: PlaybackSyncService,
    private sanitizer: DomSanitizer
  ) {
  }

  @Input() CurrentPlayerType = PlayerType.Nothing;
  @Input() IsHost = false;
  @Input() UniqueId = '';
  PlayerType = PlayerType;
  IsPlaying = false;
  IsReady = false;

  /** Set while a clip is showing, which is a plain frame rather than the interactive player. */
  ClipEmbedUrl: SafeResourceUrl | null = null;

  /** Set when the link is a Twitch link that none of the embeds can play. */
  Unplayable = false;

  TimeUpdate: NodeJS.Timeout;
  IsPlayingUpdate: Subscription;
  VideoUpdate: Subscription;
  ServerTimeUpdate: Subscription;
  player: TwitchPlayer;

  /** What the current link points at, which decides both which embed to use and whether syncing means anything. */
  private source: TwitchSource | null = null;

  /**
   * How often the player is polled.
   *
   * Serves three purposes: sampling the host's position for the report cadence, catching a play state change
   * the embed's events did not deliver, and stopping playback when the room has moved to another player.
   */
  private static readonly pollIntervalMs = 100;

  ngAfterViewInit(): void {
    // Subscribed here rather than in ngOnInit because the source arrives synchronously from a subject that
    // already holds the current video, and building the player needs the element it attaches to. In ngOnInit
    // the template has not rendered, so the embed would be given an id that resolves to nothing. The delay this
    // replaces was in the video handler for the same reason, guessing at how long the view takes.
    this.AddSubscriptions();
  }

  ngOnChanges() {
    if (this.CurrentPlayerType != PlayerType.Twitch) {
      this.player?.pause();
    }
  }

  ngOnDestroy() {
    this.IsPlayingUpdate?.unsubscribe();
    this.VideoUpdate?.unsubscribe();
    this.ServerTimeUpdate?.unsubscribe();
    clearInterval(this.TimeUpdate);
    this.player = null;
  }

  /**
   * Whether the room's position means anything for what is currently loaded.
   *
   * Only a recording has a shared timeline. A live channel has no position to agree on, everyone watches the
   * edge, and seeking it is not something the embed supports. A clip is a frame with no scripting interface at
   * all. Correcting either one is at best a wasted call and at worst a jump to a position that does not exist.
   */
  private get isSeekable(): boolean {
    return this.source?.kind === 'video' && this.usesInteractivePlayer;
  }

  /**
   * Whether the interactive player is the thing currently on screen.
   *
   * False while a clip is showing. The interactive player is kept and paused rather than torn down, because the
   * embed offers no way to dispose of one, so anything that resumes playback has to check this first or the
   * viewer hears a stream playing underneath the clip.
   */
  private get usesInteractivePlayer(): boolean {
    return this.player != null && this.IsReady && this.ClipEmbedUrl === null;
  }

  /**
   * Builds the interactive player around a source, or points the existing one at it.
   *
   * The source is part of the construction options rather than something set immediately afterwards, because
   * Twitch expects an embed to be given a channel, a video or a collection when it is created. Building one
   * with an empty channel and correcting it a moment later, as this did, asks the embed to render a state that
   * has no content.
   */
  private LoadIntoPlayer(source: TwitchSource): void {
    if (this.player) {
      if (source.kind === 'channel') {
        this.player.setChannel(source.id);
      } else {
        this.player.setVideo(source.id, source.startSeconds);
      }
      return;
    }

    this.player = TwitchPlayer.FromOptions('twitchMediaPlayer', {
      height: '100%',
      width: '100%',
      // Named explicitly because Twitch refuses to render an embed whose parent does not match the page, and
      // this app is served from more than one host.
      parent: [window.location.hostname],
      autoplay: true,
      muted: false,
      channel: source.kind === 'channel' ? source.id : undefined,
      video: source.kind === 'video' ? source.id : undefined,
      time: source.kind === 'video' ? toTwitchOffset(source.startSeconds) : undefined
    });

    this.AddEventListener();
  }

  AddEventListener() {
    this.player.addEventListener(TwitchPlayerEvent.PLAY, () => {
      if (this.CurrentPlayerType != PlayerType.Twitch || this.ClipEmbedUrl !== null) {
        return;
      }
      if (this.IsHost) {
        this.playerService.PlayPause(true, this.UniqueId);
        this.ReportPosition();
        return;
      }
      // Checked against Twitch, not against the other players' types as this did before, which meant a viewer's
      // embed starting on its own was never pulled back to the room's state by this handler at all.
      if (!this.IsPlaying) {
        this.player.pause();
      }
    });

    this.player.addEventListener(TwitchPlayerEvent.PAUSE, () => {
      // Ignored while a clip is showing, because the pause this raises is the one issued to silence the
      // interactive player, and answering it by resuming would put a stream behind the clip.
      if (this.CurrentPlayerType != PlayerType.Twitch || this.ClipEmbedUrl !== null) {
        return;
      }
      if (this.IsHost) {
        this.playerService.PlayPause(false, this.UniqueId);
        this.ReportPosition();
        return;
      }
      if (this.IsPlaying) {
        this.player.play();
      }
    });

    this.player.addEventListener(TwitchPlayerEvent.READY, () => {
      this.IsReady = true;
      this.StartPolling();
    });

    this.player.addEventListener(TwitchPlayerEvent.ENDED, () => {
      if (!this.IsHost || this.CurrentPlayerType != PlayerType.Twitch || this.ClipEmbedUrl !== null) {
        return;
      }
      this.playlistService.nextVideo(this.UniqueId);
    });
  }

  /**
   * Publishes the host's exact position.
   *
   * Only for a recording: a live channel has no position the room can agree on, so sending one would have
   * viewers seeking a stream that cannot be seeked.
   */
  private ReportPosition(): void {
    if (!this.isSeekable) {
      return;
    }
    const time = this.player.getCurrentTime();
    if (typeof time === 'number' && time >= 0) {
      this.mediaService.playerTimeImmediate.next(time);
    }
  }

  private StartPolling(): void {
    clearInterval(this.TimeUpdate);
    this.TimeUpdate = setInterval(() => {
      if (!this.player) {
        return;
      }

      if (this.CurrentPlayerType != PlayerType.Twitch || this.ClipEmbedUrl !== null) {
        if (this.player.isPaused() === false) {
          this.player.pause();
        }
        return;
      }

      if (!this.IsHost) {
        // A watchdog for a play state change whose event did not arrive.
        const paused = this.player.isPaused();
        if (this.IsPlaying && paused === true) {
          this.player.play();
        } else if (!this.IsPlaying && paused === false) {
          this.player.pause();
        }
        return;
      }

      if (!this.isSeekable || this.player.isPaused() !== false) {
        return;
      }
      const time = this.player.getCurrentTime();
      if (typeof time === 'number' && time >= 0) {
        this.mediaService.playerTime.next(time);
      }
    }, TwitchComponent.pollIntervalMs);
  }

  AddSubscriptions() {
    this.ServerTimeUpdate = this.playerService.currentTime.subscribe(sync => {
      if (!sync || this.IsHost || this.CurrentPlayerType != PlayerType.Twitch || !this.isSeekable) {
        return;
      }
      this.playbackSync.apply(new TwitchTarget(this.player), sync);
    });

    this.IsPlayingUpdate = this.playerService.isplaying.subscribe(isplaying => {
      if (isplaying != null) {
        this.IsPlaying = isplaying;
      }
      if (this.IsHost || this.CurrentPlayerType != PlayerType.Twitch || !this.usesInteractivePlayer) {
        return;
      }
      if (isplaying) {
        this.player.play();
      } else {
        this.player.pause();
      }
    });

    this.VideoUpdate = this.playerService.player.subscribe(video => {
      if (this.CurrentPlayerType != PlayerType.Twitch || !video) {
        return;
      }
      this.Load(video.url);
    });
  }

  /**
   * Points the right embed at a link.
   *
   * The player is told about a channel and a recording through separate calls and the link is the only thing
   * that says which. This previously tested whether the stored value was all digits to tell them apart, but
   * the stored value is the whole URL, so the test never matched and every source was loaded as a video id that
   * happened to be a URL. Nothing played at all, for channels and recordings alike.
   */
  private Load(url: string): void {
    const source = parseTwitchSource(url);
    this.source = source;

    if (source === null) {
      this.ClipEmbedUrl = null;
      this.Unplayable = true;
      this.player?.pause();
      return;
    }

    this.Unplayable = false;

    if (source.kind === 'clip') {
      // Built from a slug matched against a strict character set and then escaped, and a host taken from the
      // page rather than from the link, so nothing from the room reaches the frame unchecked.
      this.ClipEmbedUrl = this.sanitizer
        .bypassSecurityTrustResourceUrl(clipEmbedUrl(source.id, window.location.hostname));
      this.player?.pause();
      return;
    }

    this.ClipEmbedUrl = null;
    this.LoadIntoPlayer(source);
  }
}
