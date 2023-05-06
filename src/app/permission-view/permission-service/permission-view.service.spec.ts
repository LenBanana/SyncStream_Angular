import { TestBed } from '@angular/core/testing';

import { PermissionViewService } from './permission-view.service';

describe('PermissionViewService', () => {
  let service: PermissionViewService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PermissionViewService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
