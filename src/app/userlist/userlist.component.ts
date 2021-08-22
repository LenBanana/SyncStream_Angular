import { Component, OnInit, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import { UserlistService } from './userlist-service/userlist.service';
import { Member } from '../Interfaces/Member';
import { HttpClient } from '@angular/common/http';
import { MainUser } from '../helper/Globals';
import { Location } from '@angular/common';
declare var $:any

@Component({
  selector: 'app-userlist',
  templateUrl: './userlist.component.html',
  styleUrls: ['./userlist.component.scss']
})
export class UserlistComponent implements OnInit, OnDestroy {

  constructor(public userService: UserlistService, private http: HttpClient, private loc: Location) { }

  @Input() nav: boolean;
  @Input() UniqueId: string;
  @Input() DelInterval: boolean;
  @Output() intervalOff = new EventEmitter();
  @Output() isHost = new EventEmitter();
  @Output() userlistChange = new EventEmitter();
  @Output() userAdded = new EventEmitter();
  @Input() Username: string;
  IsHost: boolean = false;
  Members: Member[] = [];
  UserUpdate;
  FailedPassword = false;
  RoomPassword = "";
  publicIP = "";
  Privileges = 0;
  userFailUpdate;
  memberUpdate;
  hostUpdate;

  ngOnDestroy() {
    clearInterval(this.UserUpdate);
    this.userService.removeMemberListener();
    this.userService.removeHostListener();
    this.userService.removeUserListener();
    this.userFailUpdate.unsubscribe();
    this.memberUpdate.unsubscribe();
    this.hostUpdate.unsubscribe();
  }

  ngOnInit(): void {
    this.Privileges = MainUser.userprivileges;
    this.userService.addMemberListener();
    this.userService.addHostListener();
    this.userService.addUserListener();
    this.AddUser();    
    this.UserUpdate = setInterval(() => {
      if (this.DelInterval) {
        clearInterval(this.UserUpdate);
        this.userService.removeUser(this.Username, this.UniqueId);
        this.intervalOff.emit();
        return;
      }
      this.userService.updateUser(this.Username, this.UniqueId);
    }, 2500);
    this.userFailUpdate = this.userService.addUserFail.subscribe(room => {
      if (room == null) {
        return;
      }
      if (room == -2) {
        $('#bannedModal').modal('show');   
        setTimeout(() => {          
          this.loc.go("/");
          window.location.reload();
        }, 1500);
        return;
      }
      if (room == -1 && this.FailedPassword == false) {
        this.FailedPassword = true;
          $('#roomPwModal').modal('show');       
      } else if (room == 1) {        
        this.FailedPassword = false;
        $('#roomPwModal').modal('hide');        
        this.userAdded.emit();
      }
    });
    this.memberUpdate = this.userService.members.subscribe(members => {
      if (!members) {
        return;
      }
      this.Members = members;
      this.userlistChange.emit(members);
    });
    this.hostUpdate = this.userService.host.subscribe(ishost => {
      if (ishost === true) {
        this.IsHost = true;
        this.isHost.emit(true);
      } else if (ishost === false) {
        this.IsHost = false;
        this.isHost.emit(false);
      }
    });
  }

  refresh(): void {
    this.loc.go("/");
    window.location.reload();
  }

  alphaKeys(event: KeyboardEvent) {    
    var key = event.key;
    if (key == "Enter" && this.RoomPassword.length>0) {
      this.AddUser();
    } 
  }

  AddUser() {    
    this.userService.addUser(this.Username, this.UniqueId, this.RoomPassword);
  }

  BanUser(username: string) {
    this.userService.banUser(username, this.UniqueId);
  }

  arraysAreEqual(ary1,ary2){
    return (ary1.join('') == ary2.join(''));
  }

  public ChangeHost(username: string) {
    this.userService.changeHost(username, this.UniqueId);    
  }

}
