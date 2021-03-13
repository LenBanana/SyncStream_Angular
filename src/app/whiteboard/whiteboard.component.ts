import { ThrowStmt } from '@angular/compiler';
import { Component, Input, OnChanges, OnInit } from '@angular/core';
import { CanvasWhiteboardComponent, CanvasWhiteboardOptions, CanvasWhiteboardService, CanvasWhiteboardUpdate } from 'ng2-canvas-whiteboard';
import { WhiteboardService } from './whiteboard-service/whiteboard-service.service';

@Component({
  selector: 'app-whiteboard',
  templateUrl: './whiteboard.component.html',
  styleUrls: ['./whiteboard.component.scss'],
  viewProviders: [CanvasWhiteboardComponent]
})
export class WhiteboardComponent implements OnInit, OnChanges {

  constructor(private _canvasWhiteboardService: CanvasWhiteboardService, private whiteBoardSerive: WhiteboardService) { }
  @Input() UniqueId: string = "bla0";
  @Input() IsDrawing = true;
  canvasOptions: CanvasWhiteboardOptions = {
    drawButtonEnabled: true,
    drawButtonClass: 'drawButtonClass',
    drawButtonText: 'Draw',
    clearButtonEnabled: true,
    clearButtonClass: 'clearButtonClass',
    clearButtonText: 'Clear',
    undoButtonText: 'Undo',
    undoButtonEnabled: true,
    colorPickerEnabled: true,
    shapeSelectorEnabled: true,
    strokeColorPickerEnabled: true,
    fillColorPickerEnabled: true,
    drawingEnabled: true,
    lineWidth: 4,
    scaleFactor: 1
};

  ngOnChanges() {
      this.canvasOptions = {
        ...this.canvasOptions,
      };    
  }

  ngOnInit(): void {
    this.whiteBoardSerive.addWhiteBoardListener();
    this.whiteBoardSerive.addWhiteBoardJoinListener();
    this.whiteBoardSerive.addWhiteBoardClearListener();
    this.whiteBoardSerive.addWhiteBoardUnDoListener();
    this.whiteBoardSerive.addWhiteBoardReDoListener();
    this.whiteBoardSerive.getWhiteBoard(this.UniqueId);    
    this.whiteBoardSerive.whiteboardJoin.subscribe(update => {
      if (update==null) {
        return;
      }
      const parsedStorageUpdates: Array<CanvasWhiteboardUpdate> = update;
      this._canvasWhiteboardService.drawCanvas(parsedStorageUpdates);
    });
    this.whiteBoardSerive.whiteboardUpdate.subscribe(update => {
      if (update==null) {
        return;
      }
      const parsedStorageUpdates: Array<CanvasWhiteboardUpdate> = update;
      this._canvasWhiteboardService.drawCanvas(parsedStorageUpdates);
    });
    this.whiteBoardSerive.whiteboardClear.subscribe(clear => {
      if (clear==null) {
        return;
      }
      this._canvasWhiteboardService.clearCanvas();
    });
    this.whiteBoardSerive.whiteboardUndo.subscribe(undo => {
      if (undo==null) {
        return;
      }
      this._canvasWhiteboardService.undoCanvas(undo);
    });
    this.whiteBoardSerive.whiteboardRedo.subscribe(redo => {
      if (redo==null) {
        return;
      }
      this._canvasWhiteboardService.redoCanvas(redo);
    });
  }

  sendBatchUpdate(event) {
    this.whiteBoardSerive.updateWhiteBoard(event, this.UniqueId);
  }

  onCanvasClear() {
    this.whiteBoardSerive.clearWhiteBoard(this.UniqueId);
  }

  onCanvasUndo(event) {
    this.whiteBoardSerive.undoWhiteBoard(this.UniqueId, event);
  }

  onCanvasRedo(event) {
    this.whiteBoardSerive.redoWhiteBoard(this.UniqueId, event);
  }
}
