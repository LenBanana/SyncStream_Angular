import { Component, OnInit } from '@angular/core';
import { User } from '../Interfaces/User';
import { SignalRService } from '../services/signal-r.service';
import { UserAdminService } from './user-admin-service/user-admin.service';
declare var $:any

@Component({
  selector: 'app-user-admin-modal',
  templateUrl: './user-admin-modal.component.html',
  styleUrls: ['./user-admin-modal.component.scss']
})
export class UserAdminModalComponent implements OnInit {

  constructor(public userAdminService: UserAdminService, public signalRService: SignalRService) { }
  Users: User[] = [];
  Token: string;
  UserID: number;
  DialogQuestion: string;
  DialogHeader: string;
  YesAnswer: string;
  NoAnswer: string;
  LastSelectedUser: User;
  Privileges = new Array(4);
  page = 1;
  pageSize = 5;

  ngOnInit(): void {
    this.userAdminService.addUserListener();
    this.userAdminService.Users.subscribe(users => {
      if (!users) {
        return;
      }
      this.Users = users;
    });    
    this.signalRService.tokenUpdate.subscribe(result => {
      if (!result) {
        return;
      }
      this.Token = result.token;
      this.UserID = result.userID;
      this.userAdminService.GetUsers(this.Token, this.UserID);
    })
  }

  DeleteUser() {
    this.userAdminService.DeleteUser(this.Token, this.UserID, this.LastSelectedUser.id);
  }

  ApproveUser(user: User, approve: boolean) {
    this.userAdminService.ApproveUser(this.Token, this.UserID, user.id, approve);    
  }

  SetUserPrivileges(user: User, privileges: number) {
    this.userAdminService.SetUserPrivileges(this.Token, this.UserID, user.id, privileges);    
  }

  DeleteUserQuestion(user: User) {
    if (!this.Token || !this.UserID) {
      alert("Please wait until fully logged in and try again");
      return;
    }
    console.log("Now");
    this.LastSelectedUser = user;
    this.DialogQuestion = "Are you sure you want to delete the user " + user.username + "?";
    this.DialogHeader = "Delete User";
    this.YesAnswer = "Yes";
    this.NoAnswer = "No";
    $('#dialogModal-UserAdminQ').modal('show');
  }
}
