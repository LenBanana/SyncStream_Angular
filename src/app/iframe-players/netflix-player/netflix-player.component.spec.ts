import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { NetflixPlayerComponent } from './netflix-player.component';

describe('NetflixPlayerComponent', () => {
  let component: NetflixPlayerComponent;
  let fixture: ComponentFixture<NetflixPlayerComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ NetflixPlayerComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(NetflixPlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
