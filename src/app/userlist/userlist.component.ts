import { Component, OnInit, Input, Output, EventEmitter, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { UserlistService } from './userlist-service/userlist.service';
import { Member } from '../Interfaces/Member';
import { HttpClient } from '@angular/common/http';
import { MainUser } from '../helper/Globals';
import { Location } from '@angular/common';
import { UserUpdate } from '../player/player.component';
import { AlertType, Dialog } from '../Interfaces/Dialog';
import { DialogService } from '../text-dialog/text-dialog-service/dialog-service.service';
import { WebrtcService } from '../media/webrtc/webrtc-service/webrtc.service';
import { StreamAudience, StreamStartConfig } from '../media/webrtc/stream-start-dialog/stream-start-dialog.component';
import { BrowserSettings, loadBrowserSettings } from '../Interfaces/BrowserSettings';
import * as sha512 from 'js-sha512';
import { SignalRService } from '../services/signal-r.service';
declare var $:any

@Component({
  selector: 'app-userlist',
  templateUrl: './userlist.component.html',
  styleUrls: ['./userlist.component.scss']
})
export class UserlistComponent implements OnInit, OnChanges, OnDestroy {

  constructor(public userService: UserlistService, private http: HttpClient, private loc: Location,
              private dialogService: DialogService, public webrtcService: WebrtcService,
              private signalRService: SignalRService) { }

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
  /** True while the current user is broadcasting a P2P stream. */
  isStreaming: boolean = false;
  liveAudience: StreamAudience = 'personal';
  showStreamDialog = false;
  browserSettings: BrowserSettings = this._loadSettings();

  private _loadSettings(): BrowserSettings {
    return loadBrowserSettings();
  }
  connectionUpdate;
  private wasDisconnected = false;
  FailedPassword = false;
  RoomPassword = "";
  publicIP = "";
  Privileges = 0;
  userFailUpdate;
  memberUpdate;
  hostUpdate;

  ngOnChanges(changes: SimpleChanges) {
    // The parent sets DelInterval to ask us to leave. This used to be noticed by the next poll tick.
    if (changes['DelInterval'] && this.DelInterval) {
      this.userService.removeUser(this.UniqueId);
      this.intervalOff.emit();
    }
  }

  ngOnDestroy() {
    this.userFailUpdate.unsubscribe();
    this.memberUpdate.unsubscribe();
    this.hostUpdate.unsubscribe();
    this.connectionUpdate?.unsubscribe();
    this.userService.NullAllSubs();
  }

  ngOnInit(): void {
    this.Privileges = MainUser.userprivileges;
    // Rejoin explicitly after a dropped connection. A reconnect brings a new connection id, so the server
    // has already removed the old member; without this the user sits in a room the server does not think
    // they are in. The old code relied on a 2.5s poll whose fallback re-joined with an empty password,
    // which silently failed forever in a password-protected room.
    this.connectionUpdate = this.signalRService.connectionClosed.subscribe(closed => {
      if (closed === true) {
        this.wasDisconnected = true;
        return;
      }
      if (closed === false && this.wasDisconnected) {
        this.wasDisconnected = false;
        this.AddUser();
      }
    });
    this.userFailUpdate = this.userService.addUserFail.subscribe(room => {
      if (room == null) {
        return;
      }
      if (room == UserUpdate.NameNotAllowed) {
        // The server decides the display name: a guest's choice must be well formed and must not be a
        // registered account's name.
        const dialog: Dialog = { id: "name-not-allowed", header: "Name not available", question: "Pick a different display name. It must be 2 to 20 characters and cannot be a registered account's name.", answer1: "Ok", answer2: null, yes: null, no: null, alertType: AlertType.Warning };
        this.dialogService.newDialog.next(dialog);
        setTimeout(() => {
          this.goBack.emit();
        }, 2500);
        return;
      }
      if (room == UserUpdate.Banned) {
        const dialog: Dialog = { id: "banned-user", header: "Access restricted", question: "You have been removed from this room.", answer1: "Ok", answer2: null, yes: null, no: null, alertType: AlertType.Danger };
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

  // ---------------------------------------------------------------
  // Discord-style streaming controls
  // ---------------------------------------------------------------

  /** Start sharing screen — opens the stream-start dialog. */
  goLive(): void {
    this.browserSettings = this._loadSettings();
    this.showStreamDialog = true;
  }

  onStreamDialogCancelled(): void {
    this.showStreamDialog = false;
  }

  async onStreamDialogConfirmed(config: StreamStartConfig): Promise<void> {
    this.showStreamDialog = false;
    try {
      if (config.audience === 'room') {
        await this.webrtcService.startStreamingToRoom(this.UniqueId, config.stream, config.maxBitrate, config.resolution, config.frameRate, config.contentPreference);
      } else {
        await this.webrtcService.startStreaming(this.UniqueId, config.stream, config.maxBitrate, config.resolution, config.frameRate, config.contentPreference);
      }
      this.isStreaming = true;
      this.liveAudience = config.audience;
      // Auto-stop when the browser's native screen-share dialog is closed.
      config.stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stopLive());
    } catch (err) {
      console.error('goLive: startStreaming failed', err);
      config.stream.getTracks().forEach(t => t.stop());
    }
  }

  /** Stop the current P2P broadcast. */
  async stopLive(): Promise<void> {
    if (this.liveAudience === 'room') {
      await this.webrtcService.stopStreamingToRoom(this.UniqueId);
    } else {
      await this.webrtcService.stopStreaming(this.UniqueId);
    }
    this.isStreaming = false;
    this.liveAudience = 'personal';
  }

  /** Opt-in watch: open the popout viewer for a specific streaming member. */
  watchStreamer(member: Member): void {
    if (!member.connectionId) return;
    this.webrtcService.startWatching(this.UniqueId, member.connectionId, member.username)
      .catch(err => console.error('startWatching failed', err));
  }

}
