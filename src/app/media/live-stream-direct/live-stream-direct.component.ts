import { AfterViewInit, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { DialogService } from '../../text-dialog/text-dialog-service/dialog-service.service';
import { LiveStreamService } from '../../live-stream-view/live-stream-service/live-stream.service';
import { SignalRService } from '../../services/signal-r.service';
import { AlertType } from '../../Interfaces/Dialog';
import { PlayerService } from '../../player/player-service/player.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-live-stream-direct',
  templateUrl: './live-stream-direct.component.html',
  styleUrls: ['./live-stream-direct.component.scss']
})
export class LiveStreamDirectComponent implements OnInit, AfterViewInit {

  constructor(private route: ActivatedRoute,
    private dialogService: DialogService,
    private liveStreamService: LiveStreamService,
    private signalRService: SignalRService,
    private playerService: PlayerService) { }

  liveStream: string = "";
  liveChannelSub: Subscription;
  isLive = false;
  leaveVisible = true;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;
  ngOnInit(): void {
    this.showLeave();
  }

  /** The leave button shows while the mouse moves, and fades two seconds after it stops. */
  showLeave() {
    this.leaveVisible = true;
    if (this.leaveTimer !== null) clearTimeout(this.leaveTimer);
    this.leaveTimer = setTimeout(() => this.leaveVisible = false, 2000);
  }
  async signalR() {
    await this.signalRService.startConnection().finally(() => {
      this.addSubs();
    });
  }

  lowerFirstLetter(string: string) {
    return string.charAt(0).toLowerCase() + string.slice(1);
  }

  ngAfterViewInit(): void {
    this.signalR().then(r => {
      this.route.paramMap.subscribe(params => {
        this.liveStream = params.get('UniqueId');
        if (this.liveStream && this.liveStream.length > 0) {
          this.liveStream = this.lowerFirstLetter(this.liveStream);
          this.liveStreamService.GetLiveUsers();
        }
      });
    });
  }

  addSubs() {
    const timeOut = setTimeout(() => {
      this.LeaveRoom();
    }, 2500);
    this.liveChannelSub = this.liveStreamService.liveChannels.subscribe(c => {
      if (!c || c == null) {
        return;
      }
      console.log(c);
      clearTimeout(timeOut);
      const idx = c.findIndex(x => x.userName.trim().toLowerCase() == this.liveStream.trim().toLowerCase());
      if (idx == -1) {
        this.LeaveRoom();
        return;
      }
      this.isLive = true;
      const user = c[idx].userName;
      const url = "https://live.drecktu.be/live?stream=" + this.liveStream;
      this.playerService.player.next({title: user, url: url});
      this.liveChannelSub.unsubscribe();
    })
  }

  LeaveRoom() {
    this.dialogService.PushDefaultDialog(`User '${this.liveStream}' is not streaming`, "User not online", AlertType.Warning);
    setTimeout(() => {
      this.Leave();
    }, 2500);
  }

  Leave() {
    window.location.href = "/";
  }
}
