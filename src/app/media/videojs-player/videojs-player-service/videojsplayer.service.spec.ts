import { TestBed } from '@angular/core/testing';

import { VideojsplayerService } from './videojsplayer.service';

describe('VideojsplayerService', () => {
  let service: VideojsplayerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(VideojsplayerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
