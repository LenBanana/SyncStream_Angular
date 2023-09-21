import { TestBed } from '@angular/core/testing';

import { WebrtcSfuService } from './webrtc-sfu.service';

describe('WebrtcSfuService', () => {
  let service: WebrtcSfuService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WebrtcSfuService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
