import { TestBed } from '@angular/core/testing';

import { TwitchServiceService } from './twitch-service.service';

describe('TwitchServiceService', () => {
  let service: TwitchServiceService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TwitchServiceService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
