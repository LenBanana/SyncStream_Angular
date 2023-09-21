import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MediaDeviceModalComponent } from './media-device-modal.component';

describe('MediaDeviceModalComponent', () => {
  let component: MediaDeviceModalComponent;
  let fixture: ComponentFixture<MediaDeviceModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ MediaDeviceModalComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MediaDeviceModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
