import { TestBed } from '@angular/core/testing';

import { MediaDeviceService } from './media-device.service';

describe('MediaDeviceService', () => {
  let service: MediaDeviceService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MediaDeviceService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
