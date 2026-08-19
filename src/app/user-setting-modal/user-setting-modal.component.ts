import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { User } from '../Interfaces/User';
import { BrowserSettings, changeSettings } from '../Interfaces/BrowserSettings';
import { sponsorBlockCategoryLabels, sponsorBlockCategoryOrder } from '../Interfaces/SponsorBlock';
import { UserPrivileges } from '../user-admin-modal/user-admin-modal.component';
import { AuthService } from '../services/auth.service';
import { DialogService } from '../text-dialog/text-dialog-service/dialog-service.service';
import { AlertType } from '../Interfaces/Dialog';
declare var $: any;

@Component({
  selector: 'app-user-setting-modal',
  templateUrl: './user-setting-modal.component.html',
  styleUrls: ['./user-setting-modal.component.scss']
})
export class UserSettingModalComponent implements OnInit {

  constructor(private authService: AuthService, private dialogService: DialogService) { }
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
    // Both as typed. The server hashes them; see the note in the login modal.
    const newPassword = this.User.password.length > 0 ? this.User.password : null;
    const currentPassword = this.Password;

    this.authService.changeUser(this.User.username, newPassword, currentPassword).subscribe(result => {
      this.dialogService.PushDefaultDialog(
        result.message,
        result.ok ? "Success" : "Error",
        result.ok ? AlertType.Success : AlertType.Danger);

      if (result.ok) {
        // A password change revokes other sessions server-side, so refresh what we know about ourselves.
        this.authService.restore().subscribe();
      }
    });

    this.User.password = "";
    this.RepeatPassword = "";
    this.Password = "";
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
    this.authService.generateApiKey().subscribe(result => {
      if (!result.ok) {
        this.dialogService.PushDefaultDialog(result.message, "Error", AlertType.Danger);
        return;
      }
      // The bound User is this component's input, so copy the new key across for immediate display.
      this.User.apiKey = this.authService.user.value?.apiKey;
    });
  }

}

enum SettingsMenu {
  User,
  General,
  Stream,
  Api
}
