import {
  Component,
  OnInit,
  Input,
  Output,
  EventEmitter,
  OnDestroy,
  AfterViewInit, HostListener, ElementRef, ViewChild
} from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { PlaylistService } from '../playlist/playlist-service/playlist.service';
import { UserlistService } from '../userlist/userlist-service/userlist.service';
import { VideoDTO } from '../Interfaces/VideoDTO';
import { Member } from '../Interfaces/Member';
import { PlayerComponent, PlayerType } from '../player/player.component';
import { PlayerService } from '../player/player-service/player.service';
import { DialogService } from '../text-dialog/text-dialog-service/dialog-service.service';
import { AlertType, Dialog } from '../Interfaces/Dialog';
import { BrowserSettings, changeSettings } from '../Interfaces/BrowserSettings';
import { DreckchatService } from '../dreckchat/dreckchat-service/dreckchat.service';
import { ChatMessage } from '../Interfaces/Chatmessage';
import { Subscription } from 'rxjs';
import { LiveStreamService } from '../live-stream-view/live-stream-service/live-stream.service';
import { LiveUser } from '../Interfaces/liveStream';
import { WebrtcVoipService } from "../media/webrtc-voip/webrtc-voip-service/webrtc-voip.service";
import { UserPrivileges } from "../user-admin-modal/user-admin-modal.component";
import { AppService } from "../app.service";
import { BlackjackService } from '../blackjack-game/blackjack-service/blackjack-service.service';
import { WebrtcService } from '../media/webrtc/webrtc-service/webrtc.service';
import { StreamAudience, StreamStartConfig } from '../media/webrtc/stream-start-dialog/stream-start-dialog.component';

declare var $: any;

@Component({
  selector: 'app-side-nav',
  templateUrl: './side-nav.component.html',
  styleUrls: ['./side-nav.component.scss']
})
export class SideNavComponent implements OnInit, OnDestroy, AfterViewInit {
  private static readonly WEBRTC_FILE_SHARE_CANDIDATE_EXTENSIONS = new Set([
    'mp4', 'm4v', 'mov', 'webm', 'ogv', 'ogg'
  ]);

  @ViewChild('fileSharePickerInput') fileSharePickerInputRef!: ElementRef<HTMLInputElement>;

  constructor(public chatService: DreckchatService,
    private liveStreamService: LiveStreamService,
    private playlistService: PlaylistService,
    private playerService: PlayerService,
    private userService: UserlistService,
    private dialogService: DialogService,
    private blackjackService: BlackjackService,
    private voipService: WebrtcVoipService,
    private appService: AppService,
    public webrtcService: WebrtcService,
  ) {
  }

  @Input() logout: boolean;
  @Input() nav: boolean;
  @Input() menuHidden: boolean;
  @Input() IsHost: boolean;
  @Input() isPlaying: boolean;
  @Input() UniqueId: string;
  @Input() Username: string;
  @Input() Members: Member[];
  @Input() Playlist: VideoDTO[] = [];
  @Input() playerComp: PlayerComponent;
  @Input() ThreshholdNumber: number = 0.5;
  @Input() Privileges: number;
  @Input() BrowserSettings: BrowserSettings;
  @Input() ChatOpen: boolean;
  @Output() threshholdChange = new EventEmitter();
  @Output() usernameChange = new EventEmitter();
  @Output() toggleDreckChat = new EventEmitter();
  @Output() menuEnter = new EventEmitter();
  @Output() Draw = new EventEmitter();
  @Output() goBack = new EventEmitter();
  Threshhold = false;
  showInput = false;
  showPlaylist = false;
  showYtApi = false;
  showUsername = false;
  showMemberlist = false;
  WhiteboardActive = false;
  BlackjackActive = false;
  Voip = false;
  /** True while this user is broadcasting a P2P stream. */
  isStreaming = false;
  liveAudience: StreamAudience = 'personal';
  /** True while this user is sharing a local file via SFU. */
  isFileSharingActive = false;
  showFileShareModeDialog = false;
  pendingFileShareSelection: File | null = null;
  showStreamDialog = false;
  /** Live reference to the captured stream so the preview can render it. */
  localStream: MediaStream | null = null;
  /** True while the watched stream is in the browser Picture-in-Picture window. */
  pipIsActive = false;
  Messages: ChatMessage[];
  LiveUsers: LiveUser[] = [];
  Subscriptions: Subscription[] = [];
  pasteFn = (event) => {
    const dlManager = $('#downloadManagerModal');
    const chat = $('#videoCallModal');
    if (this.BlackjackActive || this.WhiteboardActive || (dlManager && dlManager.hasClass('show') || (chat && chat.hasClass('show')))) {
      return;
    }

    const data = event.clipboardData.items;
    for (let i = 0; i < data.length; i += 1) {
      if (data[i].kind !== 'file' || !data[i].type.match('^image/')) {
        data[i].getAsString((str) => {
          this.PlayVideo(str);
          this.appService.triggerSuccess({});
        });
      }
    }
  };

  isMobile = false;
  navTimeout = null;
  positionTimeout = null;

  @HostListener('window:resize', ['$event'])
  onResize(event) {
    5
    this.isMobile = window.innerWidth < 768 || window.innerHeight < 768;;
    const bigSideNav = this.BrowserSettings?.layoutSettings?.bigSideNav;

    clearTimeout(this.navTimeout);
    clearTimeout(this.positionTimeout);

    if (bigSideNav) {
      this.handleNavTimeout(() => {
        $('.menu-msg').removeClass('menu-hide menu-show');
        $('.badge-dreck').addClass('text-left');
        this.setMenuPosition(0, 0);
      });
    } else if (this.isMobile) {
      this.setMenuPosition(0, 0);
    } else {
      this.handleNavTimeout(() => {
        $('.menu-msg').addClass('menu-hide').removeClass('menu-show');
        $('.badge-dreck').removeClass('text-left');
        const relativeX = this.BrowserSettings.layoutSettings.menuPosition.x
        const relativeY = this.BrowserSettings.layoutSettings.menuPosition.y
        $('#side-nav-drag-menu').css('top', relativeY + 'px').css('left', relativeX + 'px');
      });
    }

    const menuPosition = $('#side-nav-drag-menu').position();
    if (menuPosition?.left > window.innerWidth - 100 || menuPosition?.left < 0) {
      this.handlePositionTimeout(() => {
        this.setMenuPosition(null, window.innerWidth - 100);
      });
    }

    if (menuPosition?.top > window.innerHeight - 100 || menuPosition?.top < 0) {
      this.handlePositionTimeout(() => {
        this.setMenuPosition(window.innerHeight - 100, null);
      });
    }
  }

  handleNavTimeout(callback: Function) {
    this.navTimeout = setTimeout(callback, 100);
  }

  handlePositionTimeout(callback: Function) {
    this.positionTimeout = setTimeout(callback, 100);
  }

  setMenuPosition(top: number | null, left: number | null) {
    const menu = $('#side-nav-drag-menu');
    if (top !== null) menu.css('top', top + 'px');
    if (left !== null) menu.css('left', left + 'px');
    if (top === 0 && left === 0) menu.css('transform', '');
  }


  getRelativePosition(position) {
    const x = position.left;
    const y = position.top;
    const xP = x / window.innerWidth;
    const yP = y / window.innerHeight;
    return { x: xP, y: yP };
  }

  openDownloadManager() {
    $('#downloadManagerModal').modal('show');
  }

  openLiveChannels() {
    $('#liveViewModal').modal('show');
  }

  ngAfterViewInit(): void {
    document.addEventListener('paste', this.pasteFn);
    this.isMobile = window.innerWidth < 768 || window.innerHeight < 768;
    if (this.BrowserSettings?.layoutSettings?.bigSideNav) {
      $('.menu-msg').toggleClass('menu-hide').toggleClass('menu-show');
      $('.badge-dreck').toggleClass('text-left');
    }
    else if (this.isMobile) {
      this.setMenuPosition(0, 0);
    }
    else if (this.BrowserSettings?.layoutSettings?.menuPosition && !this.isMobile) {
      const relativeX = this.BrowserSettings.layoutSettings.menuPosition.x
      const relativeY = this.BrowserSettings.layoutSettings.menuPosition.y
      console.log(relativeX, relativeY);
      $('#side-nav-drag-menu').css('top', relativeY + 'px').css('left', relativeX + 'px');
    }
  }

  GetFontSize() {
    let fSize = 90;
    if (this.BrowserSettings?.layoutSettings?.menuSize) {
      fSize = this.BrowserSettings.layoutSettings.menuSize;
    }
    if (fSize < 50) {
      fSize = 50;
    }
    if (fSize > 150) {
      fSize = 150;
    }
    return fSize;
  }

  ngOnInit(): void {
    if (this.IsHost) {
      this.ThreshholdNumber = 2;
      this.threshholdChange.emit(this.ThreshholdNumber);
    } else {
      this.ThreshholdNumber = .5;
      this.threshholdChange.emit(this.ThreshholdNumber);
    }
    this.Subscriptions.push(this.playerService.playingGallows.subscribe(playGallows => {
      if (playGallows == null || !playGallows) {
        return;
      }
      if (playGallows == "$clearboard$") {
        this.WhiteboardActive = false;
        return;
      }
      this.BlackjackActive = false;
      this.WhiteboardActive = true;
    }), this.playerService.playFile.subscribe(x => {
      if (x && x.length > 0) {
        this.PlayVideo(x);
      }
    }), this.chatService.message.subscribe(result => {
      if (result == null || this.ChatOpen) {
        this.Messages = [];
        return;
      }
      if (this.Messages == null) {
        this.Messages = [];
      }
      this.Messages.push(result);
      if (this.Messages.length >= 100) {
        this.Messages.shift();
      }
      setTimeout(() => $('#messagebox').scrollTop($('#messagebox')[0]?.scrollHeight), 100);
    }), this.liveStreamService.liveChannels.subscribe(c => {
      if (c == null) {
        this.LiveUsers = [];
        return;
      }
      this.LiveUsers = c;
    }), this.playerService.playingBlackjack.subscribe(playBlackjack => {
      if (playBlackjack == null) {
        return;
      }
      if (playBlackjack === true) {
        this.WhiteboardActive = false;
        this.BlackjackActive = true;
      }
      if (playBlackjack === false) {
        this.BlackjackActive = false;
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
      }),
      this.webrtcService.pipActive.subscribe(active => {
        this.pipIsActive = active;
      }),
      // Track both file-share paths so the Share/Stop button reflects reality.
      this.webrtcService.fileShareActive.subscribe(info => {
        this.isFileSharingActive = info !== null && this.webrtcService.isFileShareHost;
      }),
      this.webrtcService.rtmpFileShareActive.subscribe(info => {
        if (info !== null && this.webrtcService.isRtmpFileShareHost) {
          this.isFileSharingActive = true;
        }
      }));
  }

  onDragEnded(event) {
    const position = this.getRelativePosition($('#side-nav-drag-menu').position());
    let relativeX = position.x * window.innerWidth;
    let relativeY = position.y * window.innerHeight;
    if (relativeX < 0) {
      relativeX = 0;
    }
    if (relativeY < 0) {
      relativeY = 0;
    }
    
    this.BrowserSettings.layoutSettings.menuPosition = { x: relativeX, y: relativeY };
    changeSettings(this.BrowserSettings);
  }

  ngOnDestroy() {
    this.Subscriptions.forEach(s => s.unsubscribe());
    document.removeEventListener('paste', this.pasteFn);
  }

  refresh(): void {
    this.goBack.emit();
  }

  enterMenu(enter) {
    this.menuEnter.emit(enter);
  }

  showMenu() {
    this.BrowserSettings.layoutSettings.bigSideNav = !this.BrowserSettings.layoutSettings.bigSideNav;
    $('.menu-msg').toggleClass('menu-hide').toggleClass('menu-show');
    $('.badge-dreck').toggleClass('text-left');
    changeSettings(this.BrowserSettings);
  }


  hideMenu() {
    setTimeout(() => {
      this.menuHidden = true;
    }, 100);
  }

  menuClicked() {
    if (this.menuHidden) {
      this.menuHidden = false;
    }
  }

  SetHost() {
    this.userService.changeHost(this.Username, this.UniqueId);
  }

  ToggleInput() {
    if (this.showInput) {
      this.showInput = false;
    } else {
      this.ResetInputs();
      this.showInput = true;
    }
  }

  ToggleYtApi() {
    if (this.showYtApi) {
      this.showYtApi = false;
    } else {
      this.ResetInputs();
      this.showYtApi = true;
    }
  }

  TogglePlaylist() {
    if (this.showPlaylist) {
      this.showPlaylist = false;
    } else {
      this.ResetInputs();
      this.showPlaylist = true;
    }
  }

  ToggleThreshhold() {
    if (this.Threshhold) {
      this.Threshhold = false;
    } else {
      this.ResetInputs();
      this.Threshhold = true;
    }
  }

  ToggleUsername() {
    if (this.showUsername) {
      this.showUsername = false;
    } else {
      this.ResetInputs();
      this.showUsername = true;
    }
  }

  ToggleMemberlist() {
    if (this.showMemberlist) {
      this.showMemberlist = false;
    } else {
      this.ResetInputs();
      this.showMemberlist = true;
    }
  }

  ResetInputs() {
    if (this.showInput) {
      this.ToggleInput();
    }
    if (this.showPlaylist) {
      this.TogglePlaylist();
    }
    if (this.Threshhold) {
      this.ToggleThreshhold();
    }
    if (this.showUsername) {
      this.ToggleUsername();
    }
  }

  ChangeHost(username) {
    this.userService.changeHost(username, this.UniqueId);
  }

  toggleChat() {
    this.toggleDreckChat.emit();
    this.chatService.openChat.next(this.UniqueId);
    this.Messages = [];
    setTimeout(() => {
      var videourl = document.getElementById('textmessage') as HTMLInputElement;
      videourl?.focus();
    }, 25);
  }

  play(url: string) {
    this.playlistService.playVideo(url, this.UniqueId);
  }

  delete(key: string) {
    this.playlistService.removeVideo(key, this.UniqueId);
  }

  nextVideo() {
    this.playlistService.nextVideo(this.UniqueId);
  }

  drop(event: CdkDragDrop<string[]>) {
    if (event.previousIndex == event.currentIndex || event.currentIndex == 0) {
      return;
    }
    moveItemInArray(this.Playlist, event.previousIndex, event.currentIndex);
    this.playlistService.moveVideo(event.previousIndex, event.currentIndex, this.UniqueId);
  }

  PlayURL() {
    var videourl = document.getElementById('video-tooltip-input') as HTMLInputElement;
    if (!videourl || videourl.value.length === 0) {
      return;
    }
    this.playlistService.addVideo({ title: "", url: videourl.value }, this.UniqueId);
    videourl.value = "";
    this.showInput = false;
  }

  quickPlay() {
    if (!navigator || !navigator.clipboard || !navigator.clipboard.readText) {
      this.showInput = !this.showInput;
      return;
    }
    navigator.clipboard.readText()
      .then(text => {
        this.PlayVideo(text);
      })
      .catch(async err => {
        const permissionStatus = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
        if (permissionStatus.state !== "granted") {
          this.showInput = !this.showInput;
          return;
        }
      });
  }

  PlayVideo(url: string) {
    var videourl = document.getElementById('video-tooltip-input') as HTMLInputElement;
    if (!videourl) {
      return;
    }
    videourl.value = url;
    this.PlayURL();
  }

  PlayFile() {
    var filebtn = document.getElementById('playerFileBtn') as HTMLButtonElement;
    if (!filebtn) {
      return;
    }
    filebtn.click();
  }

  BanUser(username: string) {
    this.userService.banUser(username, this.UniqueId);
  }

  // ---------------------------------------------------------------
  // Discord-style streaming
  // ---------------------------------------------------------------

  goLive(): void {
    this.showStreamDialog = true;
  }

  onStreamDialogCancelled(): void {
    this.showStreamDialog = false;
  }

  async onStreamDialogConfirmed(config: StreamStartConfig): Promise<void> {
    this.showStreamDialog = false;
    try {
      if (config.audience === 'room') {
        await this.webrtcService.startStreamingToRoom(this.UniqueId, config.stream, config.maxBitrate, config.resolution, config.frameRate, config.contentPreference);
      } else {
        await this.webrtcService.startStreaming(this.UniqueId, config.stream, config.maxBitrate, config.resolution, config.frameRate, config.contentPreference);
      }
      this.isStreaming = true;
      this.liveAudience = config.audience;
      this.localStream = config.stream;
      config.stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stopLive());
    } catch (err) {
      console.error('goLive: startStreaming failed', err);
      config.stream.getTracks().forEach(t => t.stop());
    }
  }

  async stopLive(): Promise<void> {
    if (this.liveAudience === 'room') {
      await this.webrtcService.stopStreamingToRoom(this.UniqueId);
    } else {
      await this.webrtcService.stopStreaming(this.UniqueId);
    }
    this.isStreaming = false;
    this.liveAudience = 'personal';
    this.localStream = null;
  }

  watchStreamer(member: any): void {
    if (!member.connectionId) return;
    this.webrtcService.startWatching(this.UniqueId, member.connectionId, member.username)
      .catch(err => console.error('startWatching failed', err));
  }

  /** Called from the side-nav "Pop back in" button — exits PiP so the popout reappears. */
  returnFromPip(): void {
    if ((document as any).pictureInPictureElement) {
      (document as any).exitPictureInPicture().catch((err: any) => console.warn('exitPiP failed', err));
    }
  }

  // ---------------------------------------------------------------
  // File sharing
  // ---------------------------------------------------------------

  /** Open the RTMP file-share player in the media area. */
  openFileShare(): void {
    if (!this.canStartFileShare) return;
    this.fileSharePickerInputRef?.nativeElement.click();
  }

  onFileSharePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) {
      return;
    }

    if (this.shouldOfferFileShareModeChoice(file)) {
      this.pendingFileShareSelection = file;
      this.showFileShareModeDialog = true;
      return;
    }

    this.startRtmpFileShare(file);
  }

  chooseWebRtcFileShare(): void {
    const file = this.pendingFileShareSelection;
    this.closeFileShareModeDialog();
    if (!file) return;
    this.webrtcService.requestFileShareHostUi(file);
  }

  chooseRtmpFileShare(): void {
    const file = this.pendingFileShareSelection;
    this.closeFileShareModeDialog();
    if (!file) return;
    this.startRtmpFileShare(file);
  }

  closeFileShareModeDialog(): void {
    this.showFileShareModeDialog = false;
    this.pendingFileShareSelection = null;
  }

  /** Stop the active file share, regardless of transport. */
  async stopFileShare(): Promise<void> {
    if (this.webrtcService.isPreparingFileShareHost || this.webrtcService.isFileShareHost) {
      await this.webrtcService.stopFileShare(this.UniqueId);
    }
    if (this.webrtcService.isPreparingRtmpFileShareHost || this.webrtcService.isRtmpFileShareHost) {
      if (this.webrtcService.rtmpFileShareActive.value) {
        await this.webrtcService.stopRtmpFileShare(this.UniqueId);
      } else {
        this.webrtcService.cancelPreparingRtmpFileShare();
      }
    }
    this.isFileSharingActive = false;
    this.closeFileShareModeDialog();
  }

  get canStartFileShare(): boolean {
    return !this.webrtcService.fileShareActive.value &&
      !this.webrtcService.rtmpFileShareActive.value &&
      !this.webrtcService.isPreparingFileShareHost &&
      !this.webrtcService.isPreparingRtmpFileShareHost;
  }

  get isPreparingAnyFileShare(): boolean {
    return this.webrtcService.isPreparingFileShareHost || this.webrtcService.isPreparingRtmpFileShareHost;
  }

  private startRtmpFileShare(file: File): void {
    this.webrtcService.requestRtmpFileShareHostUi(file);
  }

  private shouldOfferFileShareModeChoice(file: File): boolean {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    return SideNavComponent.WEBRTC_FILE_SHARE_CANDIDATE_EXTENSIONS.has(ext);
  }

  protected readonly UserPrivileges = UserPrivileges;
}
