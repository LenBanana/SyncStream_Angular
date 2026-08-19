import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class MediaService {

  playerTime: BehaviorSubject<number> = new BehaviorSubject(null);
  constructor() { }
}
