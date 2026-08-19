import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class MediaService {

  playerTime: BehaviorSubject<number> = new BehaviorSubject(null);

  /**
   * A host position that must be published at once rather than on the next tick.
   *
   * For a seek: waiting up to a second to tell everyone the host jumped is the difference between the room
   * following along and the room appearing to lag.
   */
  playerTimeImmediate: Subject<number> = new Subject<number>();
  constructor() { }
}
