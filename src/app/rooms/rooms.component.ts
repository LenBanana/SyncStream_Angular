import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, HostListener, Inject, OnInit, ViewChild } from '@angular/core';
import { Server } from '../Interfaces/server';
import { Member } from '../Interfaces/Member';
import { ChatMessage } from '../Interfaces/Chatmessage';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { SignalRService, baseUrl } from '../services/signal-r.service';
import { ThrowStmt } from '@angular/compiler';
import { Location } from '@angular/common';
declare var $:any
import { RoomService } from './rooms-service/rooms.service';
import { User } from '../Interfaces/User';
import { randomID, randomIntFromInterval } from '../helper/generic';
import { Room } from '../Interfaces/Room';
import { MainUser } from '../helper/Globals';
import { DialogService } from '../text-dialog/text-dialog-service/dialog-service.service';
import { Dialog } from '../Interfaces/Dialog';
import { UserlistService } from '../userlist/userlist-service/userlist.service';


@Component({
  selector: 'app-rooms',
  templateUrl: './rooms.component.html',
  styleUrls: ['./rooms.component.scss'],
})
export class RoomsComponent implements OnInit {  
  rooms: Room[];
  filterRooms: Room[];
  FilterTerm = "";
  logoutDialog: Dialog = { id: 'logout', header: 'Logout', question: 'Are you sure you want to logout?', answer1: 'Yes', answer2: 'No', yes: null, no: null }
  headers: HttpHeaders = new HttpHeaders().set("Content-Type", "application/json");
  currentRoom: string;
  currentTime: number;
  delInterval: boolean;
  SignalR: boolean = false;
  user: User = { username: "", password: "", id: 0, approved: 0, userprivileges: 0 };
  logout;
  inMenu = true;
  page = 1;
  pageSize = 9;
  
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

  constructor(private route: ActivatedRoute, private userService: UserlistService, private http: HttpClient, private router: Router, public signalRService: SignalRService, public roomService: RoomService, public dialogService: DialogService, private cdRef:ChangeDetectorRef, private loc: Location) {
  // this.GetRooms();
  // this.setIntervals();
  this.onResize();
  }


  Filter() {
    if (this.FilterTerm) {
      this.filterRooms = this.rooms.filter(x => x.name.toLocaleLowerCase().includes(this.FilterTerm.toLocaleLowerCase()));
    } else {
      this.filterRooms = this.rooms;
    }
  }

  ngOnInit() {         
    this.route.paramMap.subscribe(async params => {      
      this.user.username = 'Anon' + "#" + randomIntFromInterval(100, 10000);
      await this.signalR();
      var room = params.get('UniqueId');
      if (room&&room.length>0) {
        this.JoinRoom(room, 0);
      }
    });     
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
    });
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
