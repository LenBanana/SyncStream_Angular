import { TestBed } from '@angular/core/testing';

import { DreckchatService } from './dreckchat.service';

describe('DreckchatService', () => {
  let service: DreckchatService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DreckchatService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
