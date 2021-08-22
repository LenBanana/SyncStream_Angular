import { Component, OnInit, Input, Output, EventEmitter, OnDestroy } from '@angular/core';
import { PlaylistService } from './playlist-service/playlist.service';
import { VideoDTO } from '../Interfaces/VideoDTO';
import { Observable, Subscription } from 'rxjs';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

@Component({
  selector: 'app-playlist',
  templateUrl: './playlist.component.html',
  styleUrls: ['./playlist.component.scss']
})
export class PlaylistComponent implements OnInit, OnDestroy {

  constructor(public playlistService: PlaylistService) { }
  private readySub: Subscription;

  @Input() UniqueId: string;
  @Input() ready: Observable<void>;
  @Input() nav: boolean;
  @Output() nowPlaying = new EventEmitter();
  @Output() playlistChange = new EventEmitter();
  InitialPlay: boolean = false;
  Playlist: VideoDTO[] = [];
  CurrentVideo: VideoDTO;
  dropped = false;
  failed = false;
  FirstLoad = true;
  playlistUpdate;

  ngOnInit(): void {
    this.readySub = this.ready.subscribe(() => { this.nowPlaying.emit(this.CurrentVideo); });
    this.playlistService.addPlaylistListener();
    this.playlistUpdate = this.playlistService.playlist.subscribe(result => {
      if (!result) {
        return;
      }
      this.Playlist = result;
      this.playlistChange.emit(result);
      if (result && result.length > 0) {
        this.CurrentVideo = result[0];
      } else {
        this.nowPlaying.emit(null);
      }
    });
  }

  ngOnDestroy() {
    this.readySub.unsubscribe();
    this.playlistUpdate.unsubscribe();
    this.playlistService.removePlaylistListener();
  }

  public play(url: string) {
    this.playlistService.playVideo(url, this.UniqueId);
  }

  public delete(key: string) {
    this.playlistService.removeVideo(key, this.UniqueId);
  }

  drop(event: CdkDragDrop<string[]>) {
    if (event.previousIndex == event.currentIndex || event.currentIndex == 0) {
      this.failed = true;
      setTimeout(() => {
        this.failed = false;
      }, 500);
      return;
    }
    moveItemInArray(this.Playlist, event.previousIndex, event.currentIndex);
    this.playlistService.moveVideo(event.previousIndex, event.currentIndex, this.UniqueId);
    this.dropped = true;
    setTimeout(() => {
      this.dropped = false;
    }, 500);
    //moveItemInArray(this.Playlist, event.previousIndex, event.currentIndex);
  }


}
