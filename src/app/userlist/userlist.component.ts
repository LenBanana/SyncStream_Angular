import { Component, OnInit, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import { UserlistService } from './userlist-service/userlist.service';
import { Member } from '../Interfaces/Member';
import { HttpClient } from '@angular/common/http';
import { MainUser } from '../helper/Globals';
import { Location } from '@angular/common';
import { UserUpdate } from '../player/player.component';
import { AlertType, Dialog } from '../Interfaces/Dialog';
import { DialogService } from '../text-dialog/text-dialog-service/dialog-service.service';
import * as sha512 from 'js-sha512';
declare var $:any

@Component({
  selector: 'app-userlist',
  templateUrl: './userlist.component.html',
  styleUrls: ['./userlist.component.scss']
})
export class UserlistComponent implements OnInit, OnDestroy {

  constructor(public userService: UserlistService, private http: HttpClient, private loc: Location, private dialogService: DialogService) { }

  @Input() nav: boolean;
  @Input() UniqueId: string;
  @Input() DelInterval: boolean;
  @Input() Username: string;
  @Output() intervalOff = new EventEmitter();
  @Output() isHost = new EventEmitter();
  @Output() userlistChange = new EventEmitter();
  @Output() userAdded = new EventEmitter();
  @Output() goBack = new EventEmitter();
  Initial = true;
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
    this.userFailUpdate.unsubscribe();
    this.memberUpdate.unsubscribe();
    this.hostUpdate.unsubscribe();
    this.userService.NullAllSubs();
  }

  ngOnInit(): void {
    this.Privileges = MainUser.userprivileges;
    this.UserUpdate = setInterval(() => {
      if (this.DelInterval) {
        clearInterval(this.UserUpdate);
        this.userService.removeUser(this.UniqueId);
        this.intervalOff.emit();
        return;
      }
      this.userService.updateUser(this.Username, this.UniqueId);
    }, 2500);
    this.userFailUpdate = this.userService.addUserFail.subscribe(room => {
      if (room == null) {
        return;
      }
      if (room == UserUpdate.Banned) {
        const dialog: Dialog = { id: "banned-user", header: "Access restricted", question: "You have been removed from this room.", answer1: null, answer2: null, yes: null, no: null, alertType: AlertType.Danger };
        this.dialogService.newDialog.next(dialog);
        setTimeout(() => {
          this.goBack.emit();
        }, 1500);
        return;
      }
      else if (room == UserUpdate.WrongPassword) {
        this.RoomPassword = "";
        if (this.Initial) {
          this.Initial = false;
          $('#roomPwModal').modal('show');
          return;
        }
        if (this.FailedPassword == false) {
          this.FailedPassword = true;
        }
        setTimeout(() => {
          this.FailedPassword = false;
        }, 2500);
      } else if (room == UserUpdate.Success) {
        this.FailedPassword = false;
        $('#roomPwModal').modal('hide');
        this.userAdded.emit();
      }
      else {
        $('#dialogModal-RoomNotFoundModal').modal('show');
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
    this.AddUser();
  }

  refresh(): void {
    this.goBack.emit();
  }

  alphaKeys(event: KeyboardEvent) {
    var key = event.key;
    if (key == "Enter" && this.RoomPassword.length>0) {
      this.AddUser();
    }
  }

  AddUser() {
    const pwSha: string =this.RoomPassword && this.RoomPassword.length > 0 ? sha512.sha512(this.RoomPassword) : null;
    this.userService.addUser(this.Username, this.UniqueId, pwSha);
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
