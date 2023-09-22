import { TestBed } from '@angular/core/testing';

import { WebrtcVoipService } from './webrtc-voip.service';

describe('WebrtcVoipService', () => {
  let service: WebrtcVoipService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WebrtcVoipService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
