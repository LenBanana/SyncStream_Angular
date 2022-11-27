import { Component, EventEmitter, Input, OnInit, Output, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { AlertType } from '../Interfaces/Dialog';
import { DialogService } from './text-dialog-service/dialog-service.service';
declare var $:any

@Component({
  selector: 'app-text-dialog',
  templateUrl: './text-dialog.component.html',
  styleUrls: ['./text-dialog.component.scss']
})
export class TextDialogComponent implements OnInit, OnDestroy {
  @ViewChild('Title') title: ElementRef;
  @Input() Id: string;
  @Input() Question: string;
  @Input() Header: string;
  @Input() Answer1: string;
  @Input() Answer2: string;
  @Input() AddInput: boolean;
  @Input() AlertType: AlertType;
  @Input() Closeable: boolean;
  @Output() Yes = new EventEmitter();
  @Output() No = new EventEmitter();
  inputText = "";
  AlertTypes = AlertType;
  newInput;
  constructor(private dialogService: DialogService) { }

  ngOnInit(): void {
    this.newInput = this.dialogService.newPreFill.subscribe(x => {
      if (x && x.length>0) {
        this.inputText = x;
      }
    })
  }

  ngOnDestroy(): void {
      this.newInput.unsubscribe();
  }

  NoFunction(value) {
    $('#dialogModal-' + this.Id).modal('hide');
    this.No.emit(value);
  }

  YesFunction(value) {
    $('#dialogModal-' + this.Id).modal('hide');
    this.Yes.emit(value);
  }
}
