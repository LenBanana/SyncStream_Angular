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
import { PlayerType } from '../Interfaces/PlayerType';
import {WebrtcVoipService} from "../media/webrtc-voip/webrtc-voip-service/webrtc-voip.service";
import {LiveStreamService} from "../live-stream-view/live-stream-service/live-stream.service";
import {WebrtcService} from "../media/webrtc/webrtc-service/webrtc.service";
import { AuthService } from '../services/auth.service';
import { MainUser } from '../helper/Globals';
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
  identityUpdate;

  /**
   * The name shown for a signed-out visitor, generated once.
   *
   * The session observable reports "signed out" more than once on a normal load, once as its initial value
   * and again when the session restore finds nothing, so minting a fresh name per notification renamed the
   * visitor mid-load. It also meant an expiring session could rename somebody who was already sitting in a
   * room, and the room they are in is joined under that name.
   */
  private readonly guestName = 'Anon' + "#" + randomIntFromInterval(100, 10000);
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
    this.watchIdentity();

    await this.signalRService.startConnection().finally(() => {
      this.SignalR = true;
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

      // Asked for only when we hold the privilege the hub requires. Calling it regardless is what blanked
      // the page for a signed-out visitor, and gating on capability rather than on "is there a session"
      // keeps that true if the requirement ever changes.
      if (this.authService.hasAtLeast(UserPrivileges.Approved)) {
        this.liveStreamService.GetLiveUsers();
      }
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
    // HttpOnly, so clearing it is the server's job now. The identity subscription below does the resetting:
    // clearing fields by hand here is what left privileges behind after signing out.
    this.authService.logout().subscribe();
  }

  /**
   * Keeps the view's idea of who we are in step with the session.
   *
   * Logout used to clear the username and id but not approval or privileges, so the UI went on offering
   * actions the server would refuse: the room delete button guards on privileges alone and stayed visible
   * to a signed-out visitor. Deriving all of it from one place means a sign-out, a privilege change or an
   * expired session revokes capability everywhere at once.
   */
  private watchIdentity() {
    this.identityUpdate = this.authService.user.subscribe(profile => {
      if (profile && profile.approved > 0) {
        this.user = profile;
        this.logout = true;
      } else {
        this.user = {
          username: this.guestName,
          password: "",
          id: 0,
          approved: profile?.approved ?? 0,
          userprivileges: UserPrivileges.NotApproved,
          streamToken: "",
          apiKey: ""
        };
        this.logout = false;
      }

      MainUser.username = this.user.username;
      MainUser.approved = this.user.approved;
      MainUser.userprivileges = this.user.userprivileges;
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
    if (user && user.approved > 0)
      // Identity itself is applied by watchIdentity; this is only what signing in should kick off.
      if (user.userprivileges >= UserPrivileges.Administrator) {
        this.downloadService.GetDownloads();
        this.downloadService.GetFolders();
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
      // A seed so the player has somewhere to start, not a report from the host. The position comes from the
      // room list and may be old, and nothing here knows how old, so it is marked as not playing to keep the
      // sync logic from extrapolating forward from a time it cannot date. The room replays its real state on
      // join and the host reports again within a second, which is what actually positions the player.
      this.playerService.currentTime.next({ mediaTime: time, ageMs: 0, isPlaying: false });
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
