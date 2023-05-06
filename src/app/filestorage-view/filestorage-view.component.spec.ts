import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FilestorageViewComponent } from './filestorage-view.component';

describe('FilestorageViewComponent', () => {
  let component: FilestorageViewComponent;
  let fixture: ComponentFixture<FilestorageViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ FilestorageViewComponent ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FilestorageViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
