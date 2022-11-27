import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Html5PlayerComponent } from './html5-player.component';

describe('Html5PlayerComponent', () => {
  let component: Html5PlayerComponent;
  let fixture: ComponentFixture<Html5PlayerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ Html5PlayerComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Html5PlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
