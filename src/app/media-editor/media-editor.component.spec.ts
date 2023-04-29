import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MediaEditorComponent } from './media-editor.component';

describe('MediaEditorComponent', () => {
  let component: MediaEditorComponent;
  let fixture: ComponentFixture<MediaEditorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ MediaEditorComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MediaEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
