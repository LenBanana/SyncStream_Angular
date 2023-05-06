import { TestBed } from '@angular/core/testing';

import { FilestorageViewService } from './filestorage-view.service';

describe('FilestorageViewService', () => {
  let service: FilestorageViewService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FilestorageViewService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
