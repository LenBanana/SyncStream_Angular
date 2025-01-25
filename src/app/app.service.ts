import { Injectable } from '@angular/core';
import {Subject} from "rxjs";

@Injectable({
  providedIn: 'root'
})
export class AppService {
  private successMsgSubject = new Subject<any>();
  successMsg$ = this.successMsgSubject.asObservable();
  constructor() { }

  triggerSuccess(data: any) {
    this.successMsgSubject.next(data);
  }
}
