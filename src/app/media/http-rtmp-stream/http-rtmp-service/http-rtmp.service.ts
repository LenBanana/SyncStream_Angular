import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {baseUrl} from "../../../services/signal-r.service";

@Injectable({
  providedIn: 'root'
})
export class HttpRtmpService {  constructor(private httpClient: HttpClient) {}

  sendMedia(blob: Blob) {
    const formData = new FormData();
    formData.append('media', blob, 'filename.webm');
    return this.httpClient.post(baseUrl + "/rtmp/HttpMedia", formData);
  }
}
