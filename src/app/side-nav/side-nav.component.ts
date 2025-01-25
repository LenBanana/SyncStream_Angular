import {
  Component,
  OnInit,
  Input,
  Output,
  EventEmitter,
  OnDestroy,
  AfterViewInit, HostListener
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

declare var $: any;

@Component({
  selector: 'app-side-nav',
  templateUrl: './side-nav.component.html',
  styleUrls: ['./side-nav.component.scss']
})
export class SideNavComponent implements OnInit, OnDestroy, AfterViewInit {

  constructor(public chatService: DreckchatService,
    private liveStreamService: LiveStreamService,
    private playlistService: PlaylistService,
    private playerService: PlayerService,
    private userService: UserlistService,
    private dialogService: DialogService,
    private voipService: WebrtcVoipService,
    private appService: AppService,
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
  Messages: ChatMessage[];
  LiveUsers: LiveUser[] = [];
  Subscriptions: Subscription[] = [];
  pasteFn = (event) => {
    const dlManager = $('#downloadManagerModal');
    const chat = $('#videoCallModal');
    if ((dlManager && dlManager.hasClass('show') || (chat && chat.hasClass('show')))) {
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
    if (menuPosition.left > window.innerWidth - 100 || menuPosition.left < 0) {
      this.handlePositionTimeout(() => {
        this.setMenuPosition(null, window.innerWidth - 100);
      });
    }

    if (menuPosition.top > window.innerHeight - 100 || menuPosition.top < 0) {
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

  protected readonly UserPrivileges = UserPrivileges;
}
