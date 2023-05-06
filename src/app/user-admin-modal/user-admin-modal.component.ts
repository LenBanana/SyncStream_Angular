import { Component, Input, OnDestroy, OnInit, QueryList, ViewChildren } from '@angular/core';
import { getCookie, token, userId } from '../global.settings';
import { User } from '../Interfaces/User';
import { SignalRService } from '../services/signal-r.service';
import { UserAdminService } from './user-admin-service/user-admin.service';
import { NgbdSortableHeader, SortEvent, compare } from '../Interfaces/SortableHeader';
declare var $:any

@Component({
  selector: 'app-user-admin-modal',
  templateUrl: './user-admin-modal.component.html',
  styleUrls: ['./user-admin-modal.component.scss']
})
export class UserAdminModalComponent implements OnInit, OnDestroy {

  constructor(public userAdminService: UserAdminService, public signalRService: SignalRService) { }
  @Input() user: User;
  Users: User[] = [];
  FilteredUsers: User[] = [];
  DialogQuestion: string;
  DialogHeader: string;
  YesAnswer: string;
  NoAnswer: string;
  LastSelectedUser: User;
  Privileges = UserPrivileges;
  page = 1;
  pageSize = 5;
  FilterTerm = "";
  userUpdate;
  tokenUpdate;
  loginUpdate;
  @ViewChildren(NgbdSortableHeader) headers: QueryList<NgbdSortableHeader>;

  ngOnInit(): void {
    this.userUpdate = this.userAdminService.Users.subscribe(users => {
      if (!users) {
        return;
      }
      this.Users = users;
      this.FilteredUsers = [...this.Users];
      this.Filter();
    });
    this.loginUpdate = this.signalRService.loginRequest.subscribe(result => {
      if (!result) {
        return;
      }
      if (result.approved && result.userprivileges > 2) {
        if (token && userId) {
          this.userAdminService.GetUsers(token, userId);
        }
      }
    })
    this.tokenUpdate = this.signalRService.tokenUpdate.subscribe(result => {
      if (!result) {
        return;
      }
      this.userAdminService.GetUsers(token, userId);
    })
  }

  ngOnDestroy() {
    this.userUpdate.unsubscribe();
    this.tokenUpdate.unsubscribe();
    this.userAdminService.NullAllSubs();
  }

  Filter() {
    if (this.FilterTerm) {
      this.FilteredUsers = [...this.Users].filter(x => x.username.toLocaleLowerCase().includes(this.FilterTerm.toLocaleLowerCase()));
    } else {
      this.FilteredUsers = [...this.Users];
    }
  }

	onSort({ column, direction }: SortEvent) {
		this.headers.forEach((header) => {
			if (header.sortable !== column) {
				header.direction = '';
			}
		});
		if (direction === '' || column === '') {
			this.FilteredUsers = [...this.Users];
		} else {
			this.FilteredUsers = [...this.Users].sort((a, b) => {
				const res = compare(a[column], b[column]);
				return direction === 'asc' ? res : -res;
			});
		}
	}

  DeleteUser() {
    this.userAdminService.DeleteUser(token, userId, this.LastSelectedUser.id);
  }

  ApproveUser(user: User, approve: boolean) {
    this.userAdminService.ApproveUser(token, userId, user.id, approve);
  }

  SetUserPrivileges(user: User, privileges: number) {
    this.userAdminService.SetUserPrivileges(token, userId, user.id, privileges);
  }

  GetEnumInt(name) {
    return (Number)(UserPrivileges[name]);
  }

  DeleteUserQuestion(user: User) {
    if (!token || !userId) {
      alert("Please wait until fully logged in and try again");
      return;
    }
    this.LastSelectedUser = user;
    this.DialogQuestion = "Are you sure you want to delete the user " + user.username + "?";
    this.DialogHeader = "Delete User";
    this.YesAnswer = "Yes";
    this.NoAnswer = "No";
    $('#dialogModal-UserAdminQ').modal('show');
  }
}

export enum UserPrivileges
{
    NotApproved = 0,
    Approved,
    Moderator,
    Administrator,
    Elevated
}

export enum AuthenticationType
{
    Token,
    API
}
