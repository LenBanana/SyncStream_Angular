import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { User } from '../Interfaces/User';
import { BrowserSettings, changeSettings } from '../Interfaces/BrowserSettings';
import { SponsorBlockCategory, sponsorBlockCategoryLabels, sponsorBlockCategoryOrder } from '../Interfaces/SponsorBlock';
import { SponsorBlockService } from '../media/youtube/sponsor-block/sponsor-block.service';
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

  constructor(private authService: AuthService, private dialogService: DialogService, private sponsorBlockService: SponsorBlockService) { }
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

  /**
   * The categories the server skips, which an administrator edits here.
   *
   * Separate from the per-browser settings beside it because a skip is performed by the host and followed by
   * everybody, so it is one decision for the site rather than a preference each viewer holds.
   */
  SkipCategories: SponsorBlockCategory[] = [];
  SavingSkipPolicy = false;

  ngOnInit(): void {
    this.User.password = "";
    this.sponsorBlockService.policy.subscribe(policy => {
      this.SkipCategories = [...policy.skipCategories];
    });
    this.sponsorBlockService.loadPolicy();
  }

  IsSkipped(category: SponsorBlockCategory): boolean {
    return this.SkipCategories.includes(category);
  }

  ToggleSkipped(category: SponsorBlockCategory, skip: boolean) {
    this.SkipCategories = skip
      ? [...this.SkipCategories, category]
      : this.SkipCategories.filter(existing => existing !== category);
  }

  SaveSkipPolicy() {
    this.SavingSkipPolicy = true;
    this.sponsorBlockService.savePolicy(this.SkipCategories).subscribe({
      next: () => {
        this.SavingSkipPolicy = false;
        this.dialogService.PushDefaultDialog(
          "Auto-skip categories saved for everyone", "Success", AlertType.Success);
      },
      error: () => {
        this.SavingSkipPolicy = false;
        this.dialogService.PushDefaultDialog(
          "Could not save the auto-skip categories", "Error", AlertType.Danger);
      }
    });
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

  /**
   * Matches the server's rule, so a password it will refuse is refused here with an explanation instead of
   * being sent and coming back as an error. Only the new password is measured: the confirmation field holds the
   * account's existing password, which may be shorter than the rule that now applies to new ones.
   */
  readonly MinPasswordLength = 8;

  Save() {
    if (this.User.password !== this.RepeatPassword || this.Password.length === 0 || this.RepeatPassword.length === 0 || this.User.password.length === 0  || this.User.username.length === 0 ) {
      return;
    }

    if (this.User.password.length < this.MinPasswordLength) {
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
