import { HttpEventType } from '@angular/common/http';
import { Component, ElementRef, Input, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { AlertType } from '../Interfaces/Dialog';
import { DownloadFile, DownloadInfo, FileFolder } from '../Interfaces/DownloadInfo';
import { DialogService } from '../text-dialog/text-dialog-service/dialog-service.service';
import { ConversionPreset, DownloadManagerService } from './download-manger-service/download-manager.service';
import { BrowserSettings, IsTwitch, IsYt } from '../Interfaces/BrowserSettings';
import { Subscription } from 'rxjs';
import { User } from '../Interfaces/User';
declare var $: any;

@Component({
  selector: 'app-download-manager',
  templateUrl: './download-manager.component.html',
  styleUrls: ['./download-manager.component.scss']
})
export class DownloadManagerComponent implements OnInit, OnDestroy {

  constructor(private downloadService: DownloadManagerService, private dialogService: DialogService) {}
  @ViewChild('fileSelect') fileSelectView: ElementRef;
  @ViewChild('fileSelectStream') fileSelectStreamView: ElementRef;
  @Input() User: User;
  @Input() IsInRoom: boolean = false;
  @Input() UniqueId: string = "";
  @Input() browserSettings: BrowserSettings;
  folderUpdate: Subscription;
  downloadProgress: Subscription;
  downloadFinished: Subscription;
  getDownloads: Subscription;
  fileFolders: Subscription;
  folderFiles: Subscription;
  files: DownloadFile[] = [];
  filterFiles: DownloadFile[] = [];
  selectionFiles: DownloadFile[] = [];
  progresses: DownloadInfo[] = [];
  downloadName = "";
  downloadUrl = "";
  fileSelect;
  currentDownloads = [];
  sortType = "name";
  lastSortType = "name";
  filterName = "";
  collapseShow = false;
  collapseProgress = false;
  pageSize = 5;
  page = 1;
  selectionPageSize = 5;
  selectionPage = 1;
  firstSort = true;
  currentFolder: FileFolder;
  AlertType = AlertType;
  ConversionPreset = ConversionPreset;
  CurrentPreset: ConversionPreset = ConversionPreset.Fast;
  CurrentYtQuality = 1080;
  DefaultQualities = [360, 480, 720, 1080];
  YtAudioOnly = false;
  DownloadSubtitles = false;
  PossibleYtQuality = [];
  LoadingQuality = false;
  finishedIds: string[] = [];
  ngOnInit(): void {
    this.folderUpdate = this.downloadService.updateFolder.subscribe(f => {
      if (this.files && f) {
        const existingIndex = this.files.findIndex(x => x.id === f.id);
        if (existingIndex === -1) {
          this.files.push(f);
        } else {
          this.files[existingIndex] = f;
        }
        this.SetFiles(this.files, false);
      }
    });
    this.downloadProgress = this.downloadService.progress.subscribe(p => {
      if (!p || p == null) {
        this.progresses = [];
        return;
      }
      if (!p.type || p.type.length == 0) {
        p.type = "Downloading File...";
      }
      var idx = this.progresses.findIndex(x => x.id == p.id);
      var finishedIdx = this.finishedIds.findIndex(x => x == p.id);
      if (idx == -1 && finishedIdx == -1) {
        this.progresses.push(p);
      } else {
        var prog = this.progresses[idx];
        if (prog.name !== p.name) prog.name = p.name;
        if (prog.progress !== p.progress) prog.progress = p.progress;
        if (prog.type !== p.type) prog.type = p.type;
      }
    });
    this.downloadFinished = this.downloadService.downloadFinished.subscribe(f => {
      if (!f || f == null) {
        return;
      }
      setTimeout(() => {
        var idx = this.progresses.findIndex(x => x.id == f);
        if (idx != -1) {
          this.progresses.splice(idx, 1);
          this.finishedIds.push(f);
            this.finishedIds.pop();
        }
        this.firstSort = true;
        this.downloadService.GetFolderFiles(this.currentFolder.id);
    }, 500);
    });
    this.fileFolders = this.downloadService.folders.subscribe(f => {
      if (!f || f == null) {
        return;
      }
      this.currentFolder = f;
      this.downloadService.GetFolderFiles(this.currentFolder.id);
    });
    this.folderFiles = this.downloadService.folderFiles.subscribe(f => {
      if (!f || f == null) {
        return;
      }
      this.SetFiles(f, false);
    });
    this.getDownloads = this.downloadService.downloadFiles.subscribe(f => {
      if (!f || f == null && f.length>0) {
        return;
      }
      if (this.currentFolder) {
        this.selectionFiles = f.filter(x => x.fileFolderId != this.currentFolder.id);
      }
    });
    this.AddFileListener();
  }

  SetFiles(files: DownloadFile[], change: boolean = true) {
    this.files = [...files];
    this.files.forEach(f => {
      f.created = f.created ? this.GetLocalDate(f.created) : null;
      f.dateToBeDeleted = f.dateToBeDeleted ? this.GetLocalDate(f.dateToBeDeleted) : null;
    });
    this.Filter();
    if (this.firstSort) {
      this.firstSort = !this.firstSort;
    }
    this.sortFilesBy(change);
  }

  GetLocalDate(d: Date): Date {
    if (!d.getDate) {
      var utcDate = new Date(d);
      var dateUTC = utcDate.toLocaleString("en-US") + " UTC";
      var date = new Date(dateUTC);
      return date;
    }
    return d;
  }

  Filter() {
    if (!this.files) {
      return;
    }
    const map = new Map(this.files.map(pos => [pos.id, pos]));
    const uniques = [...map.values()];
    if (this.filterName.length > 0) {
      this.filterFiles = [...uniques.filter(x => x.name.toLocaleLowerCase().includes(this.filterName))];
      return;
    }
    this.filterFiles = [...uniques];
  }

  UpdateFolder(folder: FileFolder) {
    this.page = 1;
    this.currentFolder = folder;
    this.selectionFiles = [];
    $('.collapseFileFooter').collapse(this.collapseShow ? 'hide' : 'show');
  }

  AddFileListener() {
    var dropZone = document.getElementById('dropZone');

    // Optional.   Show the copy icon when dragging over.  Seems to only work for chrome.
    dropZone.addEventListener('dragover', function (e) {
      e.stopPropagation();
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    dropZone.addEventListener('drop', (e) => {
      e.stopPropagation();
      e.preventDefault();
      var files = e.dataTransfer.files;
      this.FileUpload(files[0]);
    });
  }

  customTB(index, f) {
    return `${index}-${f.id}`;
  }

  ngOnDestroy(): void {
    this.downloadProgress.unsubscribe();
    this.downloadFinished.unsubscribe();
    this.getDownloads.unsubscribe();
    this.fileFolders.unsubscribe();
    this.folderFiles.unsubscribe();
    this.folderUpdate.unsubscribe();
  }

  CollapseAll() {
    $('.collapseFileFooter').collapse(this.collapseShow ? 'hide' : 'show');
    this.collapseShow = !this.collapseShow;
  }

  CollapseProgresses() {
    $('#progressCards').collapse(this.collapseProgress ? 'hide' : 'show');
    this.collapseProgress = !this.collapseProgress;
  }

  sortFilesBy(change = true) {
    if (change) {
      this.lastSortType = this.lastSortType == this.sortType ? "" : this.sortType;
    }
    if (this.sortType == "name") {
      this.filterFiles.sort((a, b) => {
        return b.name.localeCompare(a.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      })
    } else if (this.sortType == "created") {
      this.filterFiles.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
    } else if (this.sortType == "size") {
      this.filterFiles.sort((a, b) => b.length - a.length);
    }
    if (this.lastSortType == this.sortType) {
      this.filterFiles.reverse();
    }
    setTimeout(() => {
      $('.collapseFileFooter').collapse(this.collapseShow ? 'show' : 'hide');
    }, 10);
  }

  SelectFile() {
    var elemId = "fileSelect";
    var elem = document.getElementById(elemId);
    if (elem && document.createEvent) {
      var evt = document.createEvent("MouseEvents");
      evt.initEvent("click", true, false);
      elem.dispatchEvent(evt);
    }
  }

  SelectStreamFile() {
    if (this.fileSelectStreamView) {
      this.fileSelectStreamView.nativeElement.click();
    }
  }

  StreamToRoomFromFile(file: File) {
    if (!file || !this.IsInRoom || !this.UniqueId) return;

    if ((this.fileSelectStreamView)) this.fileSelectStreamView.nativeElement.value = '';

    const controller = new AbortController();
    const uploadContext = { id: crypto.randomUUID(), uploadId: null, controller };

    this.downloadService.progress.next({ id: uploadContext.id, progress: 0, type: 'Uploading to room...', name: file.name });
    const start = new Date();

    this.currentDownloads.push(uploadContext);

    this.downloadService.UploadRoomFileInChunks(
      file,
      this.UniqueId,
      state => {
        if (state.phase === 'processing') {
          this.downloadService.progress.next({
            id: uploadContext.id,
            progress: 100,
            type: 'Preparing playback for the room...',
            name: file.name
          });
          return;
        }

        const percentDone = state.totalBytes > 0 ? 100 * state.uploadedBytes / state.totalBytes : 0;
        const elapsed = new Date().getTime() - start.getTime();
        const timeLeft = percentDone > 0 ? elapsed / percentDone * (100 - percentDone) : 0;
        const dateLeft = new Date(timeLeft);
        const hours = ("0" + dateLeft.getUTCHours()).slice(-2);
        const minute = ("0" + dateLeft.getMinutes()).slice(-2);
        const second = ("0" + dateLeft.getSeconds()).slice(-2);

        this.downloadService.progress.next({
          id: uploadContext.id,
          progress: Math.round(percentDone),
          type: (Math.round(state.uploadedBytes / 1024 / 1024 * 100) / 100).toFixed(2)
            + 'MB of ' + (Math.round(state.totalBytes / 1024 / 1024 * 100) / 100).toFixed(2)
            + 'MB - remaining ' + hours + ':' + minute + ':' + second,
          name: file.name
        });
      },
      uploadId => {
        uploadContext.uploadId = uploadId;
      },
      controller.signal
    ).then(result => {
      uploadContext.uploadId = result?.uploadId || uploadContext.uploadId;
      this.downloadService.downloadFinished.next(uploadContext.id);
      if (result && result.statusCode === 401) {
        this.dialogService.PushDefaultDialog(result.errorMessage || 'You need to be logged in to stream a file to a room.', 'Unauthorized', AlertType.Warning);
        return;
      }
      if (result && result.state === 'ready') {
        this.downloadService.GetFolderFiles(this.currentFolder.id);
        return;
      }

      if (!controller.signal.aborted) {
        this.dialogService.PushDefaultDialog(result?.errorMessage || 'The file was uploaded but could not be prepared for room playback.', 'Room upload failed', AlertType.Danger);
      }
    }).catch(async _err => {
      this.downloadService.downloadFinished.next(uploadContext.id);
      if (uploadContext.uploadId) {
        await this.downloadService.CancelRoomUpload(uploadContext.uploadId);
      }
      if (!controller.signal.aborted) {
        this.dialogService.PushDefaultDialog('The room upload failed before the file became playable.', 'Room upload failed', AlertType.Danger);
      }
    });
  }

  FileSelected(file) {
    if (!file || !file.target || !file.target.files) {
      return;
    }
    var selection = file.target.files;
    if (selection == null || selection.length<1) {
      return;
    }
    for (let i = 0; i < selection.length; i++) {
      const file = selection[i];
      this.FileUpload(file);
    }
  }

  CleanUp = false;
  CleanUpTimeOut;
  CleanUpFiles(remove = false) {
    clearTimeout(this.CleanUpTimeOut);
    if (!this.CleanUp&&!remove) {
      this.CleanUpTimeOut = setTimeout(() => {
        this.CleanUp = !this.CleanUp;
      }, 3000);
    }
    if (this.CleanUp&&!remove) {
      $('#dialogModal-delete-files').modal('show');
      return;
    }
    this.downloadService.CleanUpFiles(remove);
    this.CleanUp = !this.CleanUp;
  }

  FileUpload(file: File) {
    this.fileSelectView.nativeElement.value = '';
    var id = crypto.randomUUID();
    this.downloadService.progress.next({
      id: id,
      progress: 0,
      type: 'Uploading File...',
      name: file.name
    })
    var start = new Date();
    var upload = this.downloadService.UploadFile(file).subscribe(resp => {
      if (resp.type === HttpEventType.Response) {
        this.downloadService.downloadFinished.next(id);
        this.downloadService.GetFolderFiles(this.currentFolder.id);
      }
      if (resp.type === HttpEventType.UploadProgress) {
        const percentDone = 100 * resp.loaded / resp.total;
        var elapsed = new Date().getTime() - start.getTime();
        var timeLeft = elapsed / percentDone * (100 - percentDone);
        var dateLeft = new Date(timeLeft);
        var hours = dateLeft.getUTCHours().toString();
        var minute = dateLeft.getMinutes().toString();
        var second = dateLeft.getSeconds().toString();
        hours = ("0" + hours).slice(-2);
        minute = ("0" + minute).slice(-2);
        second = ("0" + second).slice(-2);
        this.downloadService.progress.next({
          id: id,
          progress: Math.round(percentDone),
          type: (Math.round(resp.loaded / 1024 / 1024 * 100) / 100).toFixed(2) + 'MB of ' + (Math.round(resp.total / 1024 / 1024 * 100) / 100).toFixed(2) + 'MB - remaining ' + hours + ':' + minute + ":" + second,
          name: file.name
        })
      }
    }, err => {
      this.downloadService.downloadFinished.next(id);
    });
    this.currentDownloads.push({
      id: id,
      upload: upload
    });
  }

  CancelDownload(id: string) {
    var idx = this.currentDownloads.findIndex(x => x.id == id);
    var isRoomUpload = false;
    if (idx == -1) {
      var idx = this.progresses.findIndex(x => x.id == id);
    } else {
      if (this.currentDownloads[idx].controller) {
        this.currentDownloads[idx].controller.abort();
        isRoomUpload = true;
      }
      if (this.currentDownloads[idx].uploadId) {
        this.downloadService.CancelRoomUpload(this.currentDownloads[idx].uploadId);
        isRoomUpload = true;
      }
    }
    if (idx > -1) {
      if (!isRoomUpload) {
        this.downloadService.CancelM3U8Download(id.trim());
      }
      this.downloadService.downloadFinished.next(id);
    }
  }

  IsYt() { return IsYt(this.downloadUrl) };
  IsTwitch() { return IsTwitch(this.downloadUrl) };

  DownloadFile() {
    if (IsYt(this.downloadUrl)||IsTwitch(this.downloadUrl)) {
      this.DownloadYtFile();
      return;
    }
    if (this.downloadUrl.length > 0 && this.downloadUrl.startsWith("http")) {
      if (this.downloadName.length==0) {
        this.downloadName = "New File";
      }
      this.downloadService.DownloadFile(this.downloadUrl, this.downloadName, this.CurrentPreset);
      this.downloadUrl = "";
      if (this.downloadName == "New File") {
        this.downloadName = "";
      }
    }
  }

  CheckYtQuality() {
    if (this.IsYt()) {
      this.LoadingQuality = true;
      this.downloadService.GetYtQuality(this.downloadUrl).subscribe(x => {
        if (!x || x.length == 0) {
          this.LoadingQuality = false;
          this.PossibleYtQuality = this.DefaultQualities;
          return;
        }
        this.PossibleYtQuality = x;
        this.LoadingQuality = false;
        if (!this.PossibleYtQuality.includes(this.CurrentYtQuality)) {
          this.CurrentYtQuality = this.PossibleYtQuality[this.PossibleYtQuality.length - 1];
        }
      }, e => {this.LoadingQuality=false;this.PossibleYtQuality=this.DefaultQualities;this.CurrentYtQuality=1080});
      return;
    }
  }

  DownloadYtFile() {
    if (this.downloadUrl.length > 0 && this.downloadUrl.startsWith("http") && !this.LoadingQuality) {
      this.downloadService.DownloadYtFile(this.downloadUrl, this.CurrentYtQuality.toString(), this.YtAudioOnly, this.DownloadSubtitles);
      this.downloadUrl = "";
      this.PossibleYtQuality = [];
    }
  }
}
