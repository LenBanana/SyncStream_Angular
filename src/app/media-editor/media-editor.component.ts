import { Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { MediaEditorService, ImageType, AudioType, VideoType, EditorProcess } from './media-service/media-editor.service';
import { HttpEventType } from '@angular/common/http';
import { DownloadManagerService } from '../download-manager/download-manger-service/download-manager.service';
import { User } from '../Interfaces/User';
import { DialogService } from '../text-dialog/text-dialog-service/dialog-service.service';
import { AlertType, Dialog } from '../Interfaces/Dialog';
import { Subscription } from 'rxjs';
declare var $: any;

interface MediaTypeOption {
  value: number;
  label: string;
}

@Component({
  selector: 'app-media-editor',
  templateUrl: './media-editor.component.html',
  styleUrls: ['./media-editor.component.scss']
})
export class MediaEditorComponent implements OnInit, OnDestroy {
  @Input() User: User;
  @ViewChild('mediaSelect') fileSelectView: ElementRef;

  convertMode = true;
  converting = false;
  mediaType = 0;
  startMilliSeconds: number = 0;
  endMilliSeconds: number = 0;
  maxMilliSeconds: number = 0;
  currentSelection: File;
  mediaTypes: MediaTypeOption[] = [];
  mediaStates: EditorProcess[] = [];
  mediaStatus: Subscription;
  mediaFinished: Subscription;
  AlertType = AlertType;
  audio;

  constructor(public mediaService: MediaEditorService, public downloadService: DownloadManagerService, private dialogService: DialogService) { }

 ngOnDestroy(): void {
  this.mediaStatus.unsubscribe();
  this.mediaFinished.unsubscribe();
 }

  ngOnInit(): void {
    this.mediaStatus = this.mediaService.mediaStatus.subscribe(s => {
      if (!s || s == null) {
        return;
      }
      var idx = this.mediaStates.findIndex(x => x.Id == s.Id);
      if (idx != -1) {
        this.mediaStates[idx] = s;
        return;
      }
      this.converting = true;
      this.mediaStates.push(s);
    });
    this.mediaFinished = this.mediaService.mediaFinished.subscribe(s => {
      if (!s || s == null) {
        return;
      }
      var idx = this.mediaStates.findIndex(x => x.Id == s.Id);
      if (idx != -1) {
        this.mediaStates.splice(idx, 1);;
      }
      this.currentSelection = null;
      this.converting = false;
      this.maxMilliSeconds = 0;
    });
  }

  openModal() {
    $('#mediaEditorModal').modal('show');
  }
  closeModal() {
    $('#mediaEditorModal').modal('hide');
  }

  selectFile() {
    var elemId = "mediaSelect";
    var elem = document.getElementById(elemId);
    if (elem && document.createEvent) {
      var evt = document.createEvent("MouseEvents");
      evt.initEvent("click", true, false);
      elem.dispatchEvent(evt);
    }
  }

  fileSelected(file) {
    if (!file || !file.target || !file.target.files) {
      this.closeModal();
      return;
    }
    var selection = file.target.files[0];
    if (selection == null) {
      this.closeModal();
      return;
    }
    this.currentSelection = selection;
    this.maxMilliSeconds = 0;
    this.getFileDuration(this.currentSelection, (duration) => {
      this.endMilliSeconds = duration * 1000;
      this.maxMilliSeconds = duration * 1000;
      $("#slider").slider({range: true, min: 0, max: this.maxMilliSeconds, values: [this.startMilliSeconds, this.endMilliSeconds]});
    });
    var fileExt = this.currentSelection.type.split('/')[0] + "/" + this.currentSelection.name.split('.').pop();
    this.getAvailableMediaTypes(fileExt);
  }

  getFileDuration(file, callback) {
    const fileUrl = window.URL.createObjectURL(file);
    const mediaElement = new Audio(fileUrl);
    mediaElement.addEventListener('loadedmetadata', function() {
      const duration = mediaElement.duration;
      callback(duration);
      URL.revokeObjectURL(fileUrl);
    });
    mediaElement.removeEventListener('loadedmetadata', () => {});
  }

  getAudio() {
    if (this.currentSelection && this.sliderMinValue() && this.sliderMaxValue()) {
      this.audio = new Audio(URL.createObjectURL(this.currentSelection));
      this.audio.currentTime = this.sliderMinValue();
      return this.audio;
    }
    return null;
  }

  sliderMinValue() {
    return $("#slider").slider("instance") != undefined ? $("#slider").slider("values", 0) : null;
  }
  sliderMaxValue() {
    return $("#slider").slider("instance") != undefined ? $("#slider").slider("values", 1) : null;
  }

  convertMedia() {
    this.processMedia(this.currentSelection, 'ConvertMedia');
  }

  cutMedia() {
    this.processMedia(this.currentSelection, 'CutMedia');
  }

  processMedia(file: File, method: string) {
    if (!this.User.apiKey || this.User.apiKey.length == 0) {
      this.dialogService.PushDefaultDialog(`Please create an API-Key in 'Settings' to be able to use this feature.`, "Not allowed", AlertType.Warning);
      return;
    }
    this.converting = true;
    this.currentSelection = null;
    this.fileSelectView.nativeElement.value = '';
    var upload;
    if (method === 'ConvertMedia') {
      upload = this.mediaService.ConvertMedia(file, this.User.apiKey, this.mediaType);
    } else if (method === 'CutMedia') {
      upload = this.mediaService.CutMedia(file, this.User.apiKey, this.sliderMinValue(), this.sliderMaxValue());
    }
    var id = 'default';
    this.mediaStates.push({Id: id, text: 'Uploading...', alertType: AlertType.Info, progress: 0 });
    upload.subscribe(resp => {
      if (resp.type === HttpEventType.UploadProgress) {
        var idx = this.mediaStates.findIndex(x => x.Id == id);
        const percentDone = 100 * resp.loaded / resp.total;
        if (percentDone >= 100) {
          this.converting = false;
          this.mediaStates.splice(idx, 1);
        }
        else if (idx != -1) {
          this.mediaStates[idx].progress = percentDone;
        }
      }
    }, err => {
      var idx = this.mediaStates.findIndex(x => x.Id == id);
      if (idx != -1) {
        this.mediaStates.splice(idx, 1);
      }
      this.converting = false;
    }, () => {
    });
  }

  getAvailableMediaTypes(currentType: string) {
    const type = currentType.toLowerCase();
    this.mediaTypes = [];
    const newMediaTypes = [];

    if (type.startsWith('image') || type.endsWith('pdf')) {
      newMediaTypes.push(...Object.values(ImageType)
        .filter(value => typeof value === 'number')
        .filter(value => !type.endsWith(ImageType[value].toLowerCase()))
        .map(value => ({ value: value as number, label: ImageType[value] })));
    }

    if (type.startsWith('audio') || type.startsWith('video')) {
      newMediaTypes.push(...Object.values(AudioType)
        .filter(value => typeof value === 'number')
        .filter(value => !type.endsWith(AudioType[value].toLowerCase()))
        .map(value => ({ value: value as number, label: AudioType[value] })));
    }

    if (type.startsWith('video') || type.endsWith('gif')) {
      newMediaTypes.push(...Object.values(VideoType)
        .filter(value => typeof value === 'number')
        .filter(value => !type.endsWith(VideoType[value].toLowerCase()))
        .map(value => ({ value: value as number, label: VideoType[value] })));
    }

    if (newMediaTypes.length === 0) {
      this.closeModal();
      this.currentSelection = null;
      this.dialogService.PushDefaultDialog(`Type ${type} is not supported.`, "Type error", AlertType.Warning);
    } else {
      this.mediaTypes.push(...newMediaTypes);
      this.mediaTypes.sort((a, b) => a.label.localeCompare(b.label));
      this.mediaType = this.mediaTypes[0].value;
    }
  }
}
