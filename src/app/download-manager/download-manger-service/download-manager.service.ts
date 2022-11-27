import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { getCookie, token } from '../../global.settings';
import { AlertType, Dialog } from '../../Interfaces/Dialog';
import { DownloadFile, DownloadInfo, FileFolder } from '../../Interfaces/DownloadInfo';
import { hubConnection, baseUrl, SignalRService } from '../../services/signal-r.service';
import { DialogService } from '../../text-dialog/text-dialog-service/dialog-service.service';

@Injectable({
  providedIn: 'root'
})
export class DownloadManagerService {

  progress: BehaviorSubject<DownloadInfo> = new BehaviorSubject(null);
  downloadFinished: BehaviorSubject<string> = new BehaviorSubject(null);
  downloadFiles: BehaviorSubject<DownloadFile[]> = new BehaviorSubject(null);
  folderFiles: BehaviorSubject<DownloadFile[]> = new BehaviorSubject(null);
  folders: BehaviorSubject<FileFolder> = new BehaviorSubject(null);
  browserResults: BehaviorSubject<string[]> = new BehaviorSubject(null);
  fileInfo: BehaviorSubject<object> = new BehaviorSubject(null);
  Token = token;
  constructor(private signalRService: SignalRService, private http: HttpClient, private dialogService: DialogService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addFolderListener();
        this.addDownloadListener();
        this.addDownloadsListener();
        this.addFolderFileListener();
        this.addBrowserResultListener();
        this.addFileInfoResultListener();
        this.addDownloadRemovedListener();
        this.addDownloadProgressListener();
        this.addDownloadFinishedListener();
        this.GetDownloads();
        this.GetFolders();
      }
      if (isClosed===true) {
        this.removeFolderListener();
        this.removeDownloadListener();
        this.removeDownloadsListener();
        this.removeFolderFileListener();
        this.removeBrowserResultListener();
        this.removeFileInfoResultListener();
        this.removeDownloadRemovedListener();
        this.removeDownloadProgressListener();
        this.removeDownloadFinishedListener();
        this.downloadFiles.next([]);
        this.progress.next(null);
      }
    });
  }

  public CleanUpFiles(remove: boolean = false) {
    if (this.Token) {
      hubConnection.invoke('CleanUpFiles', this.Token, remove);
    }
  }

  public UploadFile(file: File) {
    if (this.Token) {
      const formData: FormData = new FormData();
      formData.append('fileKey', file, file.name);
      return this.http.post(baseUrl + "api/video/addVideo?token=" + this.Token, formData, {
        reportProgress: true,
        observe: 'events'
      });
    }
  }

  public displayObject(obj: object) {
    var txt = "Info<br>";
    Object.keys(obj).forEach(i => {
      txt += "<p class=\"p-0 m-0\"><span class=\"badge badge-primary mr-2\">" + this.capitalizeFirstLetter(i) + "</span>" + "<span class=\"short-text-file\">" + obj[i] + "</span></p>";
    });
    const dialog: Dialog = {
      id: "file-info",
      header: "File info",
      question: txt,
      answer1: "Ok",
      answer2: null,
      yes: null,
      no: null,
      alertType: AlertType.Info
    };
    this.dialogService.newDialog.next(dialog);
  }

  capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  public DownloadFile(url: string, name: string, preset: ConversionPreset) {
    if (this.Token) {
      hubConnection.invoke('DownloadFile', this.Token, url, name, preset);
    }
  }

  public ChangeDownload(fileId: number, fileName: string) {
    if (this.Token) {
      hubConnection.invoke('ChangeDownload', this.Token, fileId, fileName);
    }
  }

  public GetDownloads() {
    if (this.Token) {
      hubConnection.invoke('GetDownloads', this.Token);
    }
  }

  public GetFolders(folderId: number = 1) {
    if (this.Token) {
      hubConnection.invoke('GetFolders', this.Token, folderId);
    }
  }

  public AddFolder(folderId: number) {
    if (this.Token) {
      hubConnection.invoke('AddFolder', this.Token, folderId);
    }
  }

  public ShareFolder(folderId: number, userId: number) {
    if (this.Token) {
      hubConnection.invoke('ShareFolder', this.Token, folderId, userId);
    }
  }

  public DeleteFolder(folderId: number) {
    if (this.Token) {
      hubConnection.invoke('DeleteFolder', this.Token, folderId);
    }
  }

  public ChangeFolderName(folderId: number, folderName: string) {
    if (this.Token) {
      hubConnection.invoke('ChangeFolderName', this.Token, folderId, folderName);
    }
  }

  public GetFolderFiles(folderId: number) {
    if (this.Token) {
      hubConnection.invoke('GetFolderFiles', this.Token, folderId);
    }
  }

  public ChangeFolder(fileId: number, folderId: number) {
    if (this.Token) {
      hubConnection.invoke('ChangeFolder', this.Token, fileId, folderId);
    }
  }

  public CancelM3U8Download(downloadId: string) {
    if (this.Token) {
      hubConnection.invoke('CancelConversion', this.Token, downloadId);
    }
  }

  public GetFileInfo(id: number) {
    if (this.Token) {
      hubConnection.invoke('GetFileInfo', this.Token, id);
    }
  }

  public RemoveFile(id: number) {
    if (this.Token) {
      hubConnection.invoke('RemoveFile', this.Token, id);
    }
  }

  public addFileInfoResultListener() {
    hubConnection.on('getFileInfo', (data) => {
      this.displayObject(data);
      this.fileInfo.next(data);
    });
  }

  public removeFileInfoResultListener() {
    hubConnection.off('getFileInfo', (data) => {
    });
  }

  public addBrowserResultListener() {
    hubConnection.on('browserResults', (data) => {
      this.browserResults.next(data);
    });
  }

  public removeBrowserResultListener() {
    hubConnection.off('browserResults', (data) => {
    });
  }

  public addDownloadRemovedListener() {
    hubConnection.on('downloadRemoved', (data) => {
    });
  }

  public removeDownloadRemovedListener() {
    hubConnection.off('downloadRemoved', (data) => {
    });
  }

  public addDownloadsListener() {
    hubConnection.on('getDownloads', (data) => {
      this.downloadFiles.next(data);
    });
  }

  public removeDownloadsListener() {
    hubConnection.off('getDownloads', (data) => {
    });
  }

  public addDownloadListener() {
    hubConnection.on('downloadListen', (data) => {
      if (data) {
        //this.progress.next({ id: data, progress: 0, type: 'Downloading File...'});
      }
    });
  }

  public removeDownloadListener() {
    hubConnection.off('downloadListen', (data) => {
    });
  }

  public addFolderListener() {
    hubConnection.on('getFolders', (data) => {
      this.folders.next(data);
    });
  }

  public removeFolderListener() {
    hubConnection.off('getFolders', (data) => {
    });
  }

  public addFolderFileListener() {
    hubConnection.on('getFolderFiles', (data) => {
      this.folderFiles.next(data);
    });
  }

  public removeFolderFileListener() {
    hubConnection.off('getFolderFiles', (data) => {
    });
  }

  public addDownloadProgressListener() {
    hubConnection.on('downloadProgress', (data) => {
      this.progress.next(data);
    });
  }

  public removeDownloadProgressListener() {
    hubConnection.off('downloadProgress', (data) => {
    });
  }

  public addDownloadFinishedListener() {
    hubConnection.on('downloadFinished', (data) => {
      this.downloadFinished.next(data);
    });
  }

  public removeDownloadFinishedListener() {
    hubConnection.off('downloadFinished', (data) => {
    });
  }
}

export enum ConversionPreset {
  VerySlow = 0,
  Slower = 1,
  Slow = 2,
  Medium = 3,
  Fast = 4,
  Faster = 5,
  VeryFast = 6,
  SuperFast = 7,
  UltraFast = 8
}
