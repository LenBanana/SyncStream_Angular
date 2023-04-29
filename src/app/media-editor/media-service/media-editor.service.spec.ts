import { TestBed } from '@angular/core/testing';

import { MediaEditorService } from './media-editor.service';

describe('MediaEditorService', () => {
  let service: MediaEditorService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MediaEditorService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
