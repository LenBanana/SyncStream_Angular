import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MpegtsPlayerComponent } from './mpegts-player.component';

describe('MpegtsPlayerComponent', () => {
  let component: MpegtsPlayerComponent;
  let fixture: ComponentFixture<MpegtsPlayerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ MpegtsPlayerComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MpegtsPlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
