import { Injectable } from '@angular/core';
import { token } from '../../global.settings';
import { HttpClient } from '@angular/common/http';
import { SignalRService, baseUrl, hubConnection } from '../../services/signal-r.service';
import { AlertType } from '../../Interfaces/Dialog';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class MediaEditorService {
  mediaStatus: BehaviorSubject<EditorProcess> = new BehaviorSubject(null);
  mediaFinished: BehaviorSubject<EditorProcess> = new BehaviorSubject(null);
  constructor(private signalRService: SignalRService,private http: HttpClient) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addStatusListener();
        this.addStatusFinishedListener();
      }
      if (isClosed===true) {
        this.removeStatusListener();
        this.removeStatusFinishedListener();
      }
    });
   }

   public addStatusListener() {
     hubConnection.on('mediaStatus', (data) => {
       this.mediaStatus.next(data);
     });
   }

   public removeStatusListener() {
     hubConnection.off('mediaStatus', (data) => {
     });
   }
   public addStatusFinishedListener() {
     hubConnection.on('finishStatus', (data) => {
       this.mediaFinished.next(data);
     });
   }

   public removeStatusFinishedListener() {
     hubConnection.off('finishStatus', (data) => {
     });
   }

  public ConvertMedia(file: File, apiKey: string, mediaType: number) {
    if (token) {
      const formData: FormData = new FormData();
      formData.append('fileKey', file, file.name);
      return this.http.post(baseUrl + "api/media/ConvertMedia?apiKey=" + apiKey + "&mediaType=" + mediaType, formData, {
        reportProgress: true,
        observe: 'events',
        responseType: 'blob'
      });
    }
  }

  public CutMedia(file: File, apiKey: string, startMilliSeconds: number, endMilliSeconds: number) {
    if (token) {
      const formData: FormData = new FormData();
      formData.append('fileKey', file, file.name);
      formData.append('startMilliSeconds', startMilliSeconds.toString());
      formData.append('endMilliSeconds', endMilliSeconds.toString());
      return this.http.post(baseUrl + "api/media/CutMedia?apiKey=" + apiKey, formData, {
        reportProgress: true,
        observe: 'events',
        responseType: 'blob'
      });
    }
  }
}

export enum ImageType {
  PNG,
  JPEG,
  BMP,
  TIFF,
  WEBP,
  PDF
}

export enum AudioType {
  MP3 = 6,
  WAV,
  OGG,
  FLAC,
  AIFF,
  M4A
}

export enum VideoType {
  MP4 = 12,
  WEBM,
  FLV,
  AVI,
  WMV,
  MOV,
  MKV,
  GIF
}

export interface EditorProcess {
  Id: string,
  text: string,
  alertType: AlertType,
  progress: number
}
