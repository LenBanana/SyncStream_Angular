import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { User } from '../Interfaces/User';
import * as sha512 from 'js-sha512';
import { UserSettingService } from './user-setting-service/user-setting.service';
import { BrowserSettings, changeSettings } from '../Interfaces/BrowserSettings';
import { sponsorBlockCategoryLabels, sponsorBlockCategoryOrder } from '../Interfaces/SponsorBlock';
import { UserPrivileges } from '../user-admin-modal/user-admin-modal.component';
declare var $: any;

@Component({
  selector: 'app-user-setting-modal',
  templateUrl: './user-setting-modal.component.html',
  styleUrls: ['./user-setting-modal.component.scss']
})
export class UserSettingModalComponent implements OnInit {

  constructor(public userSettingService: UserSettingService) { }
  @Input() User: User;
  @Input() BrowserSettings: BrowserSettings;
  Password = "";
  RepeatPassword = "";
  CurrentSettings: SettingsMenu = SettingsMenu.User;
  SettingsMenu = SettingsMenu;
  ShowStreamKey = false;
  ShowApiKey = false;
  UserPrivileges = UserPrivileges;
  SponsorBlockCategoryOrder = sponsorBlockCategoryOrder;
  SponsorBlockCategoryLabels = sponsorBlockCategoryLabels;
  ngOnInit(): void {
    this.User.password = "";
  }

  ChangeSettings() {
    changeSettings(this.BrowserSettings);
  }

  ResetMenuPosition() {
    this.BrowserSettings.layoutSettings.menuPosition = null;
    this.ChangeSettings();
  }

  GetFontSize() {
    let fSize = 90;
    if (this.BrowserSettings?.layoutSettings?.menuSize) {
      fSize = this.BrowserSettings.layoutSettings.menuSize;
    }
    if (fSize < 50) {
      fSize = 50;
    }
    if (fSize > 150) {
      fSize = 150;
    }
    return fSize;
  }

  Save() {
    if (this.User.password !== this.RepeatPassword || this.Password.length === 0 || this.RepeatPassword.length === 0 || this.User.password.length === 0  || this.User.username.length === 0 ) {
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

  CopyStreamServer() {
    navigator.clipboard.writeText('rtmp://drecktu.be/live');
    $('#clipboardStreamServerIcon').removeClass('fa-clipboard')
    $('#clipboardStreamServerIcon').addClass('fa-check')
    $('#clipboardStreamServerIcon').prop("disabled",true);
    setTimeout(() => {
      $('#clipboardStreamServerIcon').addClass('fa-clipboard')
      $('#clipboardStreamServerIcon').removeClass('fa-check')
      $('#clipboardStreamServerIcon').prop("disabled",false);
    }, 500);
  }

  CopyStreamKey() {
    navigator.clipboard.writeText(this.User.username.toLowerCase() + '?token=' + this.User.streamToken);
    $('#clipboardStreamKeyIcon').removeClass('fa-clipboard')
    $('#clipboardStreamKeyIcon').addClass('fa-check')
    $('#clipboardStreamKeyIcon').prop("disabled",true);
    setTimeout(() => {
      $('#clipboardStreamKeyIcon').addClass('fa-clipboard')
      $('#clipboardStreamKeyIcon').removeClass('fa-check')
      $('#clipboardStreamKeyIcon').prop("disabled",false);
    }, 500);
  }

  CopyApiKey() {
    navigator.clipboard.writeText(this.User.apiKey);
    $('#clipboardApiKeyIcon').removeClass('fa-clipboard')
    $('#clipboardApiKeyIcon').addClass('fa-check')
    $('#clipboardApiKeyIcon').prop("disabled",true);
    setTimeout(() => {
      $('#clipboardApiKeyIcon').addClass('fa-clipboard')
      $('#clipboardApiKeyIcon').removeClass('fa-check')
      $('#clipboardApiKeyIcon').prop("disabled",false);
    }, 500);
  }

  GenerateApiKey() {
    this.userSettingService.GenerateApiKey();
  }

}

enum SettingsMenu {
  User,
  General,
  Stream,
  Api
}
