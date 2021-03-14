import { ThrowStmt } from '@angular/compiler';
import { Component, Input, OnChanges, OnDestroy, OnInit } from '@angular/core';
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
  @Input() UniqueId: string = "";
  @Input() IsDrawing = false;
  canvasOptions: CanvasWhiteboardOptions = {
    drawButtonEnabled: true,
    drawButtonClass: 'fa fa-pencil fa-2x p-2',
    drawButtonText: '',
    clearButtonEnabled: true,
    clearButtonClass: 'fa fa-trash fa-2x p-2',
    clearButtonText: '',
    undoButtonText: 'Undo',
    undoButtonEnabled: false,
    redoButtonText: 'Redo',
    redoButtonEnabled: false,
    colorPickerEnabled: true,
    shapeSelectorEnabled: true,
    strokeColorPickerEnabled: true,
    fillColorPickerEnabled: true,
    drawingEnabled: true,
    batchUpdateTimeoutDuration: 50,
    lineWidth: 4,
    scaleFactor: 1
};

  ngOnChanges() {
      if (this.IsDrawing === true) {        
        this.whiteBoardSerive.getWhiteBoard(this.UniqueId);    
      }
  }

  ngOnInit(): void {
    this.whiteBoardSerive.addWhiteBoardListener();
    this.whiteBoardSerive.addWhiteBoardJoinListener();
    this.whiteBoardSerive.addWhiteBoardClearListener();
    this.whiteBoardSerive.addWhiteBoardUnDoListener();
    this.whiteBoardSerive.addWhiteBoardReDoListener();
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

  delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
  }

  async sendBatchUpdate(event) {
    if (event.length > 25) {
      var i,j,temparray,chunk = 25;
      for (i=0,j=event.length; i<j; i+=chunk) {
          temparray = event.slice(i,i+chunk);
          this.whiteBoardSerive.updateWhiteBoard(temparray, this.UniqueId);
          await this.delay(1);
      }
      return;
    }
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
