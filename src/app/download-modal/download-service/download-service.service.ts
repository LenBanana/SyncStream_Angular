import { Injectable } from '@angular/core';
import { ChatMessage } from '../../Interfaces/Chatmessage';
import { BehaviorSubject } from 'rxjs';
import { hubConnection, baseUrl } from '../../services/signal-r.service';
import { HttpClient } from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class DownloadService {

  dlUpdates: BehaviorSubject<object> = new BehaviorSubject(null);

  constructor(private http: HttpClient) { }

  public addDownloadListener(listeningId: string) {
    hubConnection.on('dlUpdate' + listeningId, (data) => {
      this.dlUpdates.next(data);
    })
  }

  public removeDownloadListener(listeningId: string) {
    hubConnection.off('dlUpdate' + listeningId);
    this.dlUpdates.next(null);
  }

  public sendDownloadRequst(url: string, filename: string, listeningId: string) {
    hubConnection.invoke('DownloadMovie', url, filename, listeningId);
  }
}
