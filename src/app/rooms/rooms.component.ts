import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Inject, OnInit, ViewChild } from '@angular/core';
import { Server } from '../Interfaces/server';
import { Member } from '../Interfaces/Member';
import { ChatMessage } from '../Interfaces/Chatmessage';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { SignalRService, baseUrl } from '../services/signal-r.service';
import { ThrowStmt } from '@angular/compiler';
import { Location } from '@angular/common';
declare var $:any
import { RoomService } from './rooms-service/rooms.service';
import { User } from '../Interfaces/User';
import { randomID, randomIntFromInterval } from '../helper/generic';
import { Room } from '../Interfaces/Room';
import { MainUser } from '../helper/Globals';


@Component({
  selector: 'app-rooms',
  templateUrl: './rooms.component.html',
  styleUrls: ['./rooms.component.scss'],
})
export class RoomsComponent implements OnInit {
  @ViewChild('usernameInput') usernameElement: ElementRef;
  
  rooms: Room[];
  headers: HttpHeaders = new HttpHeaders().set("Content-Type", "application/json");
  currentRoom: string;
  currentTime: number;
  delInterval: boolean;
  SignalR: boolean = false;
  user: User = { username: "", password: "", id: 0, approved: 0, userprivileges: 0 };
  logout = false;
  AskLogout = false;
  NewDesign = true;

  constructor(private http: HttpClient, private router: Router, public signalRService: SignalRService, public roomService: RoomService, private cdRef:ChangeDetectorRef, private loc: Location) {
  // this.GetRooms();
  // this.setIntervals();
  }

  ngOnInit() {        
    this.user.username = 'Anon' + "#" + randomIntFromInterval(100, 10000);
    this.signalR();
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
    if (room.server.ytURLs.length==0&&!room.server.isplaying&&room.server.ytURL.title=="Nothing playing") {
      return bg + "radial-gradient(ellipse at bottom, #565F8F 0%, #262A3F 100%);";
    }
    else if (room.server.ytURLs.length>0&&!room.server.ytURL.url.toLocaleLowerCase().includes('twitch')&&!room.server.ytURL.url.toLocaleLowerCase().includes('youtube')) {
      return bg + "radial-gradient(ellipse at bottom, #7f7fd5 0%, #3434A0 100%);";
    }
    else if ((room.server.ytURLs.length>0||room.server.ytURL.title.toLocaleLowerCase().includes('youtube'))&&room.server.ytURL.url.toLocaleLowerCase().includes('youtube')) {
      return bg + "radial-gradient(ellipse at bottom, #D33B2B 0%, #93291e 100%);";
    }
    else if (room.server.ytURLs.length>0&&room.server.ytURL.url.toLocaleLowerCase().includes('twitch')) {
      return bg + "radial-gradient(ellipse at bottom, #811ED8 0%, #3E0F68 100%);";
    }
    else {
      return bg + "radial-gradient(ellipse at bottom, #434A6F 0%, #262A3F 100%);";
    }
  }
  
  private async signalR() {
    await this.signalRService.startConnection().finally(() => {
      this.signalRService.addRoomListener();     
      this.SignalR = true;
      this.cdRef.detectChanges();
    });    

    this.signalRService.room.subscribe(result => {      
      this.rooms = result;
      this.cdRef.detectChanges();
    });
    
    this.signalRService.connectionClosed.subscribe(con => {
      if (con === false) {      
        setTimeout(() => {      
          this.GetRoomsInitial();
        }, 1000);
      }
    });
  }

  public Logout() {
    this.SaveLogin(null, true);
  }

  public SaveLogin(user: User, logout: boolean) { 
    if (user) {
      this.user = user; 
      this.logout = true;
    }
    if (!logout) {
      this.roomService.GenerateRememberToken(user, navigator.appVersion);
    } else {
      this.user.username = 'Anon' + "#" + randomIntFromInterval(100, 10000);
      this.user.id = 0;
      const curDate = new Date();
      curDate.setDate(curDate.getDate() - 30);
      document.cookie = "login-token=none; expires=" + curDate.toUTCString();
      this.logout = false;
    }
  }

  private GetRoomsInitial = () => {
    this.http.get(baseUrl + 'api/Server/GetRooms/').subscribe(res => {});
  }

  public ResetView() {
    this.delInterval = true;
  }

  public async GetRooms() {
    this.rooms = await this.http.get<Room[]>(baseUrl + 'api/Server/GetRooms').toPromise();    
  }

  public JoinRoom(uniqueId: string, time: number) {
    this.delInterval = false;
    this.loc.go('/room/' + uniqueId);
    this.currentRoom = uniqueId;
    this.currentTime = time;
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
