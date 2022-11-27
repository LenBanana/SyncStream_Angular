import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, Inject, OnInit, ViewChild } from '@angular/core';
import { Server } from '../Interfaces/server';
import { Member } from '../Interfaces/Member';
import { ChatMessage } from '../Interfaces/Chatmessage';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { SignalRService, baseUrl } from '../services/signal-r.service';
import { Location } from '@angular/common';
declare var $:any
import { RoomService } from './rooms-service/rooms.service';
import { User } from '../Interfaces/User';
import { randomID, randomIntFromInterval } from '../helper/generic';
import { Room } from '../Interfaces/Room';
import { MainUser } from '../helper/Globals';
import { DialogService } from '../text-dialog/text-dialog-service/dialog-service.service';
import { AlertType, Dialog } from '../Interfaces/Dialog';
import { UserlistService } from '../userlist/userlist-service/userlist.service';
import { browserSettingName, BrowserSettings, LayoutSettings, settingsUpdate } from '../Interfaces/BrowserSettings';
import { ChessService } from '../chess-game/chess-service/chess.service';
import { NgxChessBoardService } from 'ngx-chess-board';
import { getCookie } from '../global.settings';
import { DownloadManagerService } from '../download-manager/download-manger-service/download-manager.service';
import { PlayerService } from '../player/player-service/player.service';
import { LiveUser } from '../Interfaces/liveStream';


@Component({
  selector: 'app-rooms',
  templateUrl: './rooms.component.html',
  styleUrls: ['./rooms.component.scss'],
})
export class RoomsComponent implements OnInit {
  rooms: Room[];
  filterRooms: Room[];
  FilterTerm = "";
  logoutDialog: Dialog = { id: 'logout', header: 'Logout', question: 'Are you sure you want to logout?', answer1: 'Yes', answer2: 'No', yes: null, no: null, alertType: AlertType.Info }
  chessEndDialog: Dialog = { id: 'endchess', header: 'Checkmate', question: 'Chess game is over, reset now?', answer1: 'Yes', answer2: 'No', yes: null, no: null, alertType: AlertType.Info }
  headers: HttpHeaders = new HttpHeaders().set("Content-Type", "application/json");
  currentRoom: string;
  currentTime: number;
  delInterval: boolean;
  SignalR: boolean = false;
  user: User = { username: "", password: "", id: 0, approved: 0, userprivileges: 0, streamToken: "" };
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

  constructor(private route: ActivatedRoute, private playerService: PlayerService, private downloadService: DownloadManagerService, private chessService: ChessService, private ngxChessBoardService: NgxChessBoardService, private userService: UserlistService, private http: HttpClient, private router: Router, public signalRService: SignalRService, public roomService: RoomService, public dialogService: DialogService, private cdRef:ChangeDetectorRef, private loc: Location) {
  // this.GetRooms();
  // this.setIntervals();
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
      var room = params.get('UniqueId');
      this.fetchSettings();
      if (room&&room.length>0) {
        this.JoinRoom(room, 0);
      }
    });
  }

  fetchSettings() {
    var itemBackup = localStorage.getItem(browserSettingName);
    if (!itemBackup||itemBackup.length == 0) {
      this.browserSettings = new BrowserSettings();
      return;
    }
    this.browserSettings = JSON.parse(itemBackup) as BrowserSettings;
  }

  trackByFn(index, item: Room) {
    return item.uniqueId; // or item.id
  }

  AddRoom() {
    if (this.logout==true&&this.user.id>0&&this.user.approved>0) {
      $("#addRoomModal").modal('show');
    } else {
      $("#loginModal").modal('show');
    }
  }

  getStyle(room: Room) {
    const bg = "background: ";
    if (room.server.playlist.length==0&&!room.server.isplaying&&room.server.currentVideo.title=="Nothing playing") {
      return bg + "radial-gradient(ellipse at bottom, #565F8F 0%, #262A3F 100%);";
    }
    else if (room.server.playlist.length>0&&!room.server.currentVideo.url.toLocaleLowerCase().includes('twitch')&&!room.server.currentVideo.url.toLocaleLowerCase().includes('youtube')) {
      return bg + "radial-gradient(ellipse at bottom, #7f7fd5 0%, #3434A0 100%);";
    }
    else if ((room.server.playlist.length>0||room.server.currentVideo.title.toLocaleLowerCase().includes('youtube'))&&room.server.currentVideo.url.toLocaleLowerCase().includes('youtube')) {
      return bg + "radial-gradient(ellipse at bottom, #D33B2B 0%, #93291e 100%);";
    }
    else if (room.server.playlist.length>0&&room.server.currentVideo.url.toLocaleLowerCase().includes('twitch')) {
      return bg + "radial-gradient(ellipse at bottom, #811ED8 0%, #3E0F68 100%);";
    }
    else {
      return bg + "radial-gradient(ellipse at bottom, #434A6F 0%, #262A3F 100%);";
    }
  }

  private async signalR() {
    await this.signalRService.startConnection().finally(() => {
      this.SignalR = true;
      this.cdRef.detectChanges();
    });

    this.signalRService.room.subscribe(result => {
      this.rooms = result;
      this.filterRooms = result;
      this.Filter();
      this.cdRef.detectChanges();
    });

    this.signalRService.connectionClosed.subscribe(con => {
      if (con === false) {
        this.roomService.GetRooms();
      }
      this.SignalR = !con;
    });

    /*this.signalRService.loginRequest.subscribe(result => {
      if (!result) {
        return;
      }
      if (result.approved && result.userprivileges > 2) {
        var Token = getCookie("login-token");
        if (Token) {
          this.roomService.DownloadFile(Token, "https://file-examples.com/wp-content/uploads/2017/04/file_example_MP4_1920_18MG.mp4");
        }
      }
    })*/
  }

  public Logout() {
    this.user.username = 'Anon' + "#" + randomIntFromInterval(100, 10000);
    this.user.id = 0;
    const curDate = new Date();
    curDate.setDate(curDate.getDate() - 30);
    document.cookie = "login-token=none; expires=" + curDate.toUTCString() + ";path=/;";
    this.logout = false;
  }

  public SaveLogin(user: User, logout: boolean) {
    if (!user||user.username == null) {
      this.logout = false;
      return;
    }
    if (user && user.approved == 0) {
      $('#registerModal').modal('show');
    }
    if (user && user.approved>0) {
      this.user = user;
      this.logout = true;
      this.downloadService.GetFolders();
      this.cdRef.detectChanges();
    }
    if (!logout && user.approved>0) {
      this.roomService.GenerateRememberToken(user, navigator.appVersion);
    }
  }

  public ResetView() {
    this.delInterval = true;
  }

  public JoinRoom(uniqueId: string, time: number) {
    this.delInterval = false;
    this.loc.go('/room/' + uniqueId);
    this.currentRoom = uniqueId;
    this.currentTime = time;
    this.playerService.currentTime.next(time);
  }

  public LeaveRoom() {
    this.userService.removeUser(this.currentRoom);
    this.loc.go('/');
    this.currentRoom = undefined;
  }

  refresh(): void {
    this.loc.go("/");
    //window.location.reload();
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
