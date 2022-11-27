import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PlyrPlayerComponent } from './plyr-player.component';

describe('PlyrPlayerComponent', () => {
  let component: PlyrPlayerComponent;
  let fixture: ComponentFixture<PlyrPlayerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ PlyrPlayerComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PlyrPlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
