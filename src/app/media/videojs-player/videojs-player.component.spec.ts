import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VideojsPlayerComponent } from './videojs-player.component';

describe('VideojsPlayerComponent', () => {
  let component: VideojsPlayerComponent;
  let fixture: ComponentFixture<VideojsPlayerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ VideojsPlayerComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(VideojsPlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
