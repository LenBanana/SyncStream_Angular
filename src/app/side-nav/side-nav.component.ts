import {
  Component,
  OnInit,
  Input,
  ViewChild,
  Output,
  EventEmitter,
  OnDestroy,
  AfterViewInit,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import {CdkDragDrop, moveItemInArray} from '@angular/cdk/drag-drop';
import {PlaylistService} from '../playlist/playlist-service/playlist.service';
import {UserlistService} from '../userlist/userlist-service/userlist.service';
import {VideoDTO} from '../Interfaces/VideoDTO';
import {Member} from '../Interfaces/Member';
import {PlayerComponent, PlayerType} from '../player/player.component';
import {Location} from '@angular/common';
import {PlayerService} from '../player/player-service/player.service';
import {DialogService} from '../text-dialog/text-dialog-service/dialog-service.service';
import {AlertType, Dialog} from '../Interfaces/Dialog';
import {BrowserSettings, changeSettings} from '../Interfaces/BrowserSettings';
import {DreckchatService} from '../dreckchat/dreckchat-service/dreckchat.service';
import {ChatMessage} from '../Interfaces/Chatmessage';
import {Subscription} from 'rxjs';
import {LiveStreamService} from '../live-stream-view/live-stream-service/live-stream.service';
import {LiveUser} from '../Interfaces/liveStream';
import {WebrtcService} from "../media/webrtc/webrtc-service/webrtc.service";
import {WebrtcVoipService} from "../media/webrtc-voip/webrtc-voip-service/webrtc-voip.service";

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
              private location: Location,
              private dialogService: DialogService,
              private webRtcService: WebrtcService,
              public voipService: WebrtcVoipService
  ) {
  }

  @Input() logout: boolean;
  @Input() nav: boolean;
  @Input() fullscreen: boolean;
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
  @Output() toggleTwitch = new EventEmitter();
  @Output() menuEnter = new EventEmitter();
  @Output() Draw = new EventEmitter();
  @Output() goBack = new EventEmitter();
  Threshhold = false;
  showInput = false;
  showPlaylist = false;
  showUsername = false;
  showMemberlist = false;
  WhiteboardActive = false;
  BlackjackActive = false;
  Voip = false;
  Messages: ChatMessage[];
  LiveUsers: LiveUser[] = [];
  Subscriptions: Subscription[] = [];
  pasteFn = (event) => {
    if ($('#downloadManagerModal').hasClass('show')) {
      return;
    }
    const data = event.clipboardData.items;
    for (let i = 0; i < data.length; i += 1) {
      if (data[i].kind === 'file' && data[i].type.match('^image/')) {
      } else {
        data[i].getAsString((str) => {
          this.PlayVideo(str)
          $('#add-video-success').addClass('grow-in');
          $('#add-video-success').removeClass('none');
          setTimeout(() => {
            setTimeout(() => {
              $('#add-video-success').removeClass('grow-in');
              $('#add-video-success').addClass('grow-out');
              setTimeout(() => {
                $('#add-video-success').addClass('none');
                $('#add-video-success').removeClass('grow-out');
              }, 500);
            }, 500);
          }, 10);
        });
      }
    }
  };

  openDownloadManager() {
    $('#downloadManagerModal').modal('show');
  }

  openLiveChannels() {
    $('#liveViewModal').modal('show');
  }

  ngAfterViewInit(): void {
    document.addEventListener('paste', this.pasteFn);
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
    if (this.BrowserSettings?.layoutSettings?.bigSideNav) {
      setTimeout(() => {
        $('.menu-msg').toggleClass('menu-hide');
        $('.menu-msg').toggleClass('menu-show');
        $('.badge-dreck').toggleClass('text-left');
      }, 10);
    }
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

  changeSettings() {
    changeSettings(this.BrowserSettings);
  }

  ngOnDestroy() {
    this.Subscriptions.forEach(s => s.unsubscribe());
    document.removeEventListener('paste', this.pasteFn);
  }

  StartVoip() {
    this.chatService.joinVoice.next(this.UniqueId);
  }

  refresh(): void {
    this.goBack.emit();
  }

  enterMenu(enter) {
    this.menuEnter.emit(enter);
  }

  showMenu() {
    this.BrowserSettings.layoutSettings.bigSideNav = !this.BrowserSettings.layoutSettings.bigSideNav;
    $('.menu-msg').toggleClass('menu-hide');
    $('.menu-msg').toggleClass('menu-show');
    $('.badge-dreck').toggleClass('text-left');
    changeSettings(this.BrowserSettings);
  }

  SetHost() {
    this.userService.changeHost(this.Username, this.UniqueId);
  }

  SetThreshhold() {
    var threshholdinput = document.getElementById('threshhold-input') as HTMLInputElement;
    if (!threshholdinput || threshholdinput.value.length === 0) {
      return;
    }
    this.ThreshholdNumber = Number(threshholdinput.value);
    this.threshholdChange.emit(this.ThreshholdNumber);
  }

  SetUsername() {
    var usernameinput = document.getElementById('username-input') as HTMLInputElement;
    if (!usernameinput || usernameinput.value.length === 0) {
      return;
    }
    this.Username = usernameinput.value;
    this.usernameChange.emit(this.Username);
  }

  ToggleInput() {
    if (this.showInput) {
      this.showInput = false;
    } else {
      this.ResetInputs();
      this.showInput = true;
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

  toggleTwitchChat() {
    this.toggleTwitch.emit();
    this.Messages = [];
    setTimeout(() => {
      var videourl = document.getElementById('textmessage') as HTMLInputElement;
      videourl.focus();
    }, 25);
  }

  DrawWhiteboard() {
    this.Draw.emit();
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
    //var playerinput = document.getElementById('videoinput') as HTMLInputElement;
    //if (!playerinput) {
    //  return;
    //}
    //playerinput.value = videourl.value;
    //videourl.value = "";
    //this.playerComp.PlayURL();
    this.playlistService.addVideo({title: "", url: videourl.value}, this.UniqueId);
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
        const permissionStatus = await navigator.permissions.query({name: 'clipboard-read' as PermissionName});
        if (permissionStatus.state !== "granted") {
          const dialog: Dialog = {
            id: "clipboard-perm",
            header: "Permission error",
            question: "Please grant clipboard permissions.",
            answer1: null,
            answer2: null,
            yes: null,
            no: null,
            alertType: AlertType.Warning
          };
          this.dialogService.newDialog.next(dialog);
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

}
