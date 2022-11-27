import { TestBed } from '@angular/core/testing';

import { LiveStreamService } from './live-stream.service';

describe('LiveStreamService', () => {
  let service: LiveStreamService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LiveStreamService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
