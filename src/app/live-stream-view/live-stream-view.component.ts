import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { LiveUser } from '../Interfaces/liveStream';
import { LiveStreamService } from './live-stream-service/live-stream.service';

@Component({
  selector: 'app-live-stream-view',
  templateUrl: './live-stream-view.component.html',
  styleUrls: ['./live-stream-view.component.scss']
})
export class LiveStreamViewComponent implements OnInit, OnDestroy {

  constructor(private liveStreamService: LiveStreamService) { }
  liveChannelSub: Subscription
  watchingUserSub: Subscription
  LiveUsers: LiveUser[] = [];

  ngOnInit(): void {
    this.liveChannelSub = this.liveStreamService.liveChannels.subscribe(c => {
      if (c == null) {
        this.LiveUsers = [];
        return;
      }
      this.LiveUsers = c;
    });
    this.watchingUserSub = this.liveStreamService.watchingUser.subscribe(w => {
      if (w == null) {
        return;
      }
    });
  }

  ngOnDestroy(): void {
    this.liveChannelSub.unsubscribe();
    this.watchingUserSub.unsubscribe();
  }

}
