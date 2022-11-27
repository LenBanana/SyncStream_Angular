import { TestBed } from '@angular/core/testing';

import { Html5playerService } from './html5player.service';

describe('Html5playerService', () => {
  let service: Html5playerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Html5playerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
