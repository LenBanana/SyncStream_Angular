import {
    Injectable
  } from '@angular/core';
import { Subject } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { baseUrl } from './signal-r.service';
@Injectable({
    providedIn: 'root'
  })
export class PingService {
  pingStream: Subject<number> = new Subject<number>();
  ping: number = 0;

  constructor(private _http: HttpClient) {
  }

  public GetPing() {      
    let timeStart: number = performance.now();
    this._http.get(baseUrl + "api/Server/GetDBRooms")
      .subscribe((data) => {
        let timeEnd: number = performance.now();

        let ping: number = ((timeEnd - timeStart) / 1000) + .1;
        this.ping = ping;
        this.pingStream.next(ping);
      });
  }
}