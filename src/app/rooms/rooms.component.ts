import { ChangeDetectorRef, Component, HostListener, OnInit, ViewChild } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { SignalRService } from '../services/signal-r.service';
import { Location } from '@angular/common';
import { RoomService } from './rooms-service/rooms.service';
import { User } from '../Interfaces/User';
import { randomIntFromInterval } from '../helper/generic';
import { RoomSummary } from '../Interfaces/Room';
import { DialogService } from '../text-dialog/text-dialog-service/dialog-service.service';
import { AlertType, Dialog } from '../Interfaces/Dialog';
import { UserlistService } from '../userlist/userlist-service/userlist.service';
import { BrowserSettings, IsTwitch, IsYt, loadBrowserSettings, settingsUpdate } from '../Interfaces/BrowserSettings';
import { ChessService } from '../chess-game/chess-service/chess.service';
import { NgxChessBoardService } from 'ngx-chess-board';

import { DownloadManagerService } from '../download-manager/download-manger-service/download-manager.service';
import { PlayerService } from '../player/player-service/player.service';
import { LiveUser } from '../Interfaces/liveStream';
import { MatMenuTrigger } from '@angular/material/menu';
import { UserPrivileges } from '../user-admin-modal/user-admin-modal.component';
import { PlayerType } from '../player/player.component';
import {WebrtcVoipService} from "../media/webrtc-voip/webrtc-voip-service/webrtc-voip.service";
import {LiveStreamService} from "../live-stream-view/live-stream-service/live-stream.service";
import {WebrtcService} from "../media/webrtc/webrtc-service/webrtc.service";
import { AuthService } from '../services/auth.service';
declare var $: any

@Component({
  selector: 'app-rooms',
  templateUrl: './rooms.component.html',
  styleUrls: ['./rooms.component.scss'],
})
export class RoomsComponent implements OnInit {
  @ViewChild('menuTrigger') menuTrigger: MatMenuTrigger;
  rooms: RoomSummary[];
  filterRooms: RoomSummary[];
  FilterTerm = "";
  logoutDialog: Dialog = { id: 'logout', header: 'Logout', question: 'Are you sure you want to logout?', answer1: 'Yes', answer2: 'No', yes: null, no: null, alertType: AlertType.Info }
  chessEndDialog: Dialog = { id: 'endchess', header: 'Checkmate', question: 'Chess game is over, reset now?', answer1: 'Yes', answer2: 'No', yes: null, no: null, alertType: AlertType.Info }
  headers: HttpHeaders = new HttpHeaders().set("Content-Type", "application/json");
  currentRoom: string;
  currentTime: number;
  delInterval: boolean;
  SignalR: boolean = false;
  user: User = { username: "", password: "", id: 0, approved: 0, userprivileges: 0, streamToken: "", apiKey: "" };
  logout;
  inMenu = true;
  page = 1;
  pageSize = 9;
  browserSettings: BrowserSettings = new BrowserSettings();
  LiveUsers: LiveUser[] = [];

  @HostListener('window:resize', ['$event'])
  onResize(event?) {
    if (window.innerHeight > 1000) {
      this.pageSize = 12;
    }
    if (window.innerHeight < 1000 && window.innerHeight > 800) {
      this.pageSize = 9;
    }
    if (window.innerHeight < 800 && window.innerHeight > 600) {
      this.pageSize = 6;
    }
    if (window.innerHeight < 600) {
      this.pageSize = 3;
    }
  }

  constructor(private route: ActivatedRoute,
    private playerService: PlayerService,
    private downloadService: DownloadManagerService,
    private chessService: ChessService,
    private ngxChessBoardService: NgxChessBoardService,
    private userService: UserlistService,
    private voipService: WebrtcVoipService,
    public signalRService: SignalRService,
    public roomService: RoomService,
    public dialogService: DialogService,
    public liveStreamService: LiveStreamService,
    private cdRef: ChangeDetectorRef,
    private authService: AuthService,
    private loc: Location,
    private webrtcService: WebrtcService) {
    this.onResize();
  }
  resetGame() {
    this.ngxChessBoardService.reset();
    this.chessService.resetChess(this.currentRoom);
  }
  endGame() {
    this.chessService.endChess(this.currentRoom);
    setTimeout(() => {
      this.ngxChessBoardService.reset();
      this.chessService.NullAllSubs();
    }, 10);
  }

  getEvent() {
    setTimeout(() => {
      $('.cdk-overlay-container').bind('contextmenu', (e) => {
        e.preventDefault();
        this.menuTrigger.closeMenu();
      });
    }, 10);
  }

  Filter() {
    if (this.FilterTerm) {
      this.filterRooms = this.rooms.filter(x => x.name.toLocaleLowerCase().includes(this.FilterTerm.toLocaleLowerCase()));
    } else {
      this.filterRooms = this.rooms;
    }
  }

  ngOnInit() {
    settingsUpdate.subscribe(x => {
      this.fetchSettings();
    })
    this.route.paramMap.subscribe(async params => {
      this.user.username = 'Anon' + "#" + randomIntFromInterval(100, 10000);
      await this.signalR();
      const room = params.get('UniqueId');
      this.fetchSettings();
      if (room && room.length > 0) {
        this.JoinRoom(room, 0);
      }
    });
  }

  fetchSettings() {
    this.browserSettings = loadBrowserSettings();
  }

  trackByFn(index, item: RoomSummary) {
    return item.uniqueId;
  }

  AddRoom() {
    if (this.logout == true && this.user.id > 0 && this.user.approved > 0) {
      $("#addRoomModal").modal('show');
    } else {
      $("#loginModal").modal('show');
    }
  }

  private async signalR() {
    await this.signalRService.startConnection().finally(() => {
      this.SignalR = true;
      this.liveStreamService.GetLiveUsers();
      this.cdRef.detectChanges();
    });

    // Restored only once the connection exists. Anything that reacts to the profile arriving is free to
    // call the hub, and this used to run first, so on a reload the admin view invoked a hub method while
    // hubConnection was still undefined. The handshake carries the session cookie either way, so this
    // ordering costs nothing: it is how the UI learns who it is, not what authenticates it.
    // Replaces the old ValidateToken round trip over the hub.
    const restored = await this.authService.restore().toPromise();
    if (restored) {
      this.SaveLogin(restored, true);
    }

    this.signalRService.connectionClosed.subscribe(con => {
      if (con === false) {
        this.roomService.GetRooms();
      }
      this.SignalR = !con;
    });

    this.signalRService.room.subscribe(result => {
      this.rooms = result;
      this.filterRooms = result;
      this.Filter();
      this.cdRef.detectChanges();
    });
  }

  IsYt(room: RoomSummary) { return room.playlist.length > 0 && IsYt(room.playlist[0]?.url) };
  IsTwitch(room: RoomSummary) { return room.playlist.length > 0 && IsTwitch(room.playlist[0]?.url) };

  public Logout() {
    // Server-side too, so the session is revoked rather than just forgotten by this tab. The cookie is
    // HttpOnly, so clearing it is the server's job now.
    this.authService.logout().subscribe(() => {
      this.user.username = 'Anon' + "#" + randomIntFromInterval(100, 10000);
      this.user.id = 0;
      this.logout = false;
      this.cdRef.detectChanges();
    });
  }

  public SaveLogin(user: User, logout: boolean) {
    if (!user || user.username == null) {
      this.logout = false;
      return;
    }
    if (user && user.approved == 0) {
      $('#registerModal').modal('show');
    }
    if (user && user.approved > 0) {
      this.user = user;
      this.logout = true;
      if (user.userprivileges >= UserPrivileges.Administrator) {
        this.downloadService.GetDownloads();
        this.downloadService.GetFolders();
      }
      this.cdRef.detectChanges();
    }
  }

  public ResetView() {
    this.delInterval = true;
  }

  async Join(room: RoomSummary) {
    $('#join-animation-placeholder').css({ background: this.IsYt(room) || this.IsTwitch(room) ? 'black' : 'rgb(17, 19, 26)' });
    this.JoinRoom(room.uniqueId, room.currenttime);
  }

  public JoinRoom(uniqueId: string, time: number) {
    $('#join-animation-placeholder').removeClass('none').addClass('join-room');
    this.loc.go('/room/' + uniqueId);
    setTimeout(() => {
      this.currentRoom = uniqueId;
      this.currentTime = time;
      this.delInterval = false;
      this.playerService.currentTime.next(time);
      this.roomService.JoinRoom.next(uniqueId);
      $('#join-animation-placeholder').removeClass('join-room').addClass('none');
    }, 250);
  }

  public LeaveRoom() {
    $('#join-animation-placeholder').removeClass('none').addClass('leave-room');
    // Stop any active P2P stream or viewer session before leaving.
    this.webrtcService.leaveRoom(this.currentRoom);
    this.userService.removeUser(this.currentRoom);
    this.loc.go('/');
    this.currentRoom = undefined;
    this.delInterval = true;
    this.playerService.playerType.next(PlayerType.Nothing);
    this.roomService.LeaveRoom.next(this.currentRoom);
    setTimeout(() => {
      $('#join-animation-placeholder').removeClass('leave-room').addClass('none');
    }, 250);
  }

  refresh(): void {
    this.loc.go("/");
    this.currentRoom = null;
  }

  public DeleteRoom(uniqueId: string, memberCount: number) {
    if (memberCount !== 0) {
      return;
    }
    this.signalRService.removeRoom(uniqueId);
    setTimeout(() => {
      this.cdRef.detectChanges();
    }, 100);
  }
}
