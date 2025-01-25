import { TestBed } from '@angular/core/testing';

import { HttpRtmpService } from './http-rtmp.service';

describe('HttpRtmpService', () => {
  let service: HttpRtmpService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(HttpRtmpService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
