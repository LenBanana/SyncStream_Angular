import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class MediaService {

  /**
   * The host's position, on the reporting cadence.
   *
   * A plain Subject, not a BehaviorSubject. There is no meaningful "current value" for a new subscriber: the
   * position of whatever was playing last is not the position of what is playing now. Held as a BehaviorSubject
   * it handed the previous room's last position to the media component of the next room the host joined, which
   * published it as that room's position before the player had reported anything.
   */
  playerTime: Subject<number> = new Subject<number>();

  /**
   * A host position that must be published at once rather than on the next tick.
   *
   * For a seek: waiting up to a second to tell everyone the host jumped is the difference between the room
   * following along and the room appearing to lag.
   */
  playerTimeImmediate: Subject<number> = new Subject<number>();
  constructor() { }
}
