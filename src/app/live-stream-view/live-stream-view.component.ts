import { ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { LiveUser } from '../Interfaces/liveStream';
import { PlaylistService } from '../playlist/playlist-service/playlist.service';
import { LiveStreamService } from './live-stream-service/live-stream.service';

@Component({
  selector: 'app-live-stream-view',
  templateUrl: './live-stream-view.component.html',
  styleUrls: ['./live-stream-view.component.scss']
})
export class LiveStreamViewComponent implements OnInit, OnDestroy {

  constructor(private liveStreamService: LiveStreamService, private playlistService: PlaylistService, private ref: ChangeDetectorRef) { }
  @Input() UniqueId: string;
  @Output() Users = new EventEmitter();
  liveChannelSub: Subscription
  watchingUserSub: Subscription
  timeInterval: NodeJS.Timeout;
  LiveUsers: LiveUser[] = [];
  page = 1;
  pageSize = 5;
  pageViewers = 1;
  pageSizeViewers = 5;
  startDate = new Date();

  ngOnInit(): void {
    this.liveChannelSub = this.liveStreamService.liveChannels.subscribe(c => {
      this.Users.emit(c);
      if (c == null) {
        this.LiveUsers = [];
        return;
      }
      this.LiveUsers = c;
      this.startDate = new Date();
      this.ref.detectChanges();
    });
    this.watchingUserSub = this.liveStreamService.watchingUser.subscribe(w => {
      if (w == null) {
        return;
      }
      this.startDate = new Date();
      this.ref.detectChanges();
    });
    this.timeInterval = setInterval(() => {
      this.startDate = new Date();
      this.ref.detectChanges();
    }, 1000)
  }

  ngOnDestroy(): void {
    this.liveChannelSub.unsubscribe();
    this.watchingUserSub.unsubscribe();
    clearInterval(this.timeInterval);
  }

  AddLiveStream(stream: LiveUser) {
    if (this.UniqueId && this.UniqueId.length > 0) {
      this.playlistService.addVideo({title: stream.userName, url: 'https://live.drecktu.be/live?stream=' + stream.userName.toLowerCase()}, this.UniqueId);
    }
  }
}
