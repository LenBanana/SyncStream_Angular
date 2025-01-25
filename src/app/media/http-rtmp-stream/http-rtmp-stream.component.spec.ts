import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HttpRtmpStreamComponent } from './http-rtmp-stream.component';

describe('HttpRtmpStreamComponent', () => {
  let component: HttpRtmpStreamComponent;
  let fixture: ComponentFixture<HttpRtmpStreamComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ HttpRtmpStreamComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HttpRtmpStreamComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
