import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';

import { TwitchService } from './twitch-service.service';
import { SignalRService } from '../../services/signal-r.service';

describe('TwitchService', () => {
  let service: TwitchService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TwitchService,
        {
          provide: SignalRService,
          useValue: {
            connectionClosed: new BehaviorSubject<boolean>(null)
          }
        }
      ]
    });
    service = TestBed.inject(TwitchService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
