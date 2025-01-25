import {Injectable} from '@angular/core';
import {HttpClient} from "@angular/common/http";
import {baseUrl} from "../../../../services/signal-r.service";
import {token} from "../../../../global.settings";

@Injectable({
  providedIn: 'root'
})
export class YoutubeApiService {

  constructor(private http: HttpClient) {
  }

  //Make the order parameter a selection of string values
  public searchYoutube(searchTerm: string, order: Sortage = {column: "relevance"}, pageSize: number = 10, pageToken: string = null) {
    if (!token) {
      return;
    }
    let url = baseUrl + "api/youtube/YoutubeSearch?query=" + searchTerm + "&order=" + order.column + "&pageSize=" + pageSize + "&token=" + token;
    if (pageToken) {
      url += "&pageToken=" + pageToken;
    }
    return this.http.get<YtSearchResult>(url);
  }

  public async getInputSuggestions(searchTerm: string) {
    if (!token || searchTerm.length === 0) {
      return;
    }
    let url = "https://nodered.dreckbu.de/ytac/" + searchTerm;
    let data = await this.http.get<YtAutoComplete>(url).toPromise();
    console.log(data);
    return data;
  }
}

export interface YtAutoComplete {
  suggestions: Suggestion[]
}

export interface Suggestion {
  suggestion: string
  score: number
  attributes: number[]
}

export interface Sortage {
  column: "relevance" | "date" | "rating" | "title" | "videoCount" | "viewCount"
}

export interface YtSearchResult {
  kind: string
  etag: string
  nextPageToken: string
  prevPageToken: any
  regionCode: string
  pageInfo: PageInfo
  items: Item[]
}

export interface PageInfo {
  totalResults: number
  resultsPerPage: number
}

export interface Item {
  kind: string
  etag: string
  id: Id
  snippet: Snippet
  addedToPlaylist?: boolean
}

export interface Id {
  kind: string
  videoId?: string
  channelId?: string
}

export interface Snippet {
  publishedAt: string
  channelId: string
  title: string
  description: string
  thumbnails: Thumbnails
  channelTitle: string
  liveBroadcastContent: string
  publishTime: string
}

export interface Thumbnails {
  default: any
  medium: Medium
  high: High
}

export interface Medium {
  url: string
  width: number
  height: number
}

export interface High {
  url: string
  width: number
  height: number
}
