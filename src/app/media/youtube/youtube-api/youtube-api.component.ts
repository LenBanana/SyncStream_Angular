import {Component, Input, OnInit} from '@angular/core';
import {Item, Sortage, YoutubeApiService, YtSearchResult} from "./youtube-api-service/youtube-api.service";
import {MatMenu, MatMenuTrigger} from "@angular/material/menu";
import {PlaylistService} from "../../../playlist/playlist-service/playlist.service";
import {VideoDTO} from "../../../Interfaces/VideoDTO";
import {Observable, OperatorFunction, Subject} from "rxjs";
import {debounceTime, distinctUntilChanged, map} from "rxjs/operators";

@Component({
  selector: 'app-youtube-api',
  templateUrl: './youtube-api.component.html',
  styleUrls: ['./youtube-api.component.scss']
})
export class YoutubeApiComponent implements OnInit {

  constructor(private ytApiService: YoutubeApiService, private playlistService: PlaylistService) {
  }

  @Input() UniqueId: string;
  searchTerm: string = "";
  searchResult: YtSearchResult;
  pageSize = 10;
  possiblePageSizes: number[] = [10, 20, 30, 40, 50];
  sortOptions: Map<string, string> = new Map([
    ["relevance", "Relevance"],
    ["date", "Date"],
    ["rating", "Rating"],
    ["title", "Title"],
    ["videoCount", "Video Count"],
    ["viewCount", "View Count"]
  ]);
  searchSuggestions: string[] = [];
  sortOptionsKeys: string[] = Array.from(this.sortOptions.keys());
  sortOption: string = "relevance";
  debounceTime: number = 200;
  debounceEvent: any;
  focus$ = new Subject<string>();
  click$ = new Subject<string>();

  ngOnInit(): void {

  }

  search: OperatorFunction<string, readonly string[]> = (text$: Observable<string>) =>
    text$.pipe(
      debounceTime(200),
      distinctUntilChanged(),
      map((term) =>
        term.length < 2 ? [] : this.searchSuggestions.filter((v) => v.toLowerCase().indexOf(term.toLowerCase()) > -1).slice(0, 10),
      ),
    );

  sendVideoToRoom(selectedItem: Item) {
    const video: VideoDTO = {
      url: "https://www.youtube.com/watch?v=" + selectedItem.id.videoId,
      title: selectedItem.snippet.title,
    }
    this.playlistService.addVideo(video, this.UniqueId);
    selectedItem.addedToPlaylist = true;
    setTimeout(() => {
      selectedItem.addedToPlaylist = false;
    }, 500);
  }

  searchYoutubeEvent(keydown: KeyboardEvent) {
    if (keydown.key === "Enter") {
      this.searchYoutube();
    } else {
      clearTimeout(this.debounceEvent);
      this.debounceEvent = setTimeout(() => {
        this.ytApiService.getInputSuggestions(this.searchTerm).then(result => {
          if (!result) {
            return;
          }
          this.searchSuggestions = result.suggestions.map(x => x.suggestion);
        }, error => this.searchSuggestions = []);
      }, this.debounceTime);
    }
  }

  searchYoutube() {
    if (this.searchTerm.length === 0) {
      return;
    }
    const sortage = {column: this.sortOption} as Sortage;
    this.ytApiService.searchYoutube(this.searchTerm, sortage, this.pageSize).subscribe(result => {
      this.searchResult = result;
      this.searchTerm = "";
    });
  }
}

