import { Component, Input, OnInit } from '@angular/core';
import { User } from '../Interfaces/User';
import * as sha512 from 'js-sha512';
import { UserSettingService } from './user-setting-service/user-setting.service';

@Component({
  selector: 'app-user-setting-modal',
  templateUrl: './user-setting-modal.component.html',
  styleUrls: ['./user-setting-modal.component.scss']
})
export class UserSettingModalComponent implements OnInit {

  constructor(public userSettingService: UserSettingService) { }
  @Input() User: User;
  Password = "";
  RepeatPassword = "";

  ngOnInit(): void {
  }

  Save() {
    if (this.User.password !== this.RepeatPassword) {
      return;
    }
    let dtoUser: User = {  
      ...this.User,
      password: this.User.password.length > 2 ? this.GetSha512(this.User.password) : ""
    }
    let pw = this.Password.length > 2 ? this.GetSha512(this.Password) : "";
    this.userSettingService.ChangeUser(dtoUser, pw);
    this.User.password = "";
    this.RepeatPassword = "";
    this.Password = "";
  }

  GetSha512(pw: string) {
    const pwSha: string = sha512.sha512(pw);
    return pwSha;
  }

}
