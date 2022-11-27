import { TestBed } from '@angular/core/testing';

import { PlyrService } from './plyr.service';

describe('PlyrService', () => {
  let service: PlyrService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PlyrService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
