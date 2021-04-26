import {
    Injectable
  } from '@angular/core';
import { Subject } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { baseUrl, hubConnection } from './signal-r.service';
@Injectable({
    providedIn: 'root'
  })
export class PingService {

  constructor(private _http: HttpClient) {
  }

  public GetPing() {      
    let timeStart: number = performance.now();
    hubConnection.invoke('Ping', new Date());
  }
}