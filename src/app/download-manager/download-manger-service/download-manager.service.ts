import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { token } from '../../global.settings';
import { AlertType } from '../../Interfaces/Dialog';
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
  updateFolder: BehaviorSubject<DownloadFile> = new BehaviorSubject(null);
  folders: BehaviorSubject<FileFolder> = new BehaviorSubject(null);
  browserResults: BehaviorSubject<string[]> = new BehaviorSubject(null);
  fileInfo: BehaviorSubject<object> = new BehaviorSubject(null);
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
        this.addUpdateFolderServerRequestListener();
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
        this.removeUpdateFolderServerRequestListener();
        this.downloadFiles.next([]);
        this.progress.next(null);
      }
    });
  }

  public CleanUpFiles(remove: boolean = false) {
    if (token) {
      hubConnection.invoke('CleanUpFiles', token, remove);
    }
  }

  public UploadFile(file: File) {
    if (token) {
      const formData: FormData = new FormData();
      formData.append('fileKey', file, file.name);
      return this.http.post(baseUrl + "api/video/addFile?token=" + token, formData, {
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
    this.dialogService.PushDefaultDialog(txt, "File info", AlertType.Info);
  }

  capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  public DownloadFile(url: string, name: string, preset: ConversionPreset) {
    if (token) {
      hubConnection.invoke('DownloadFile', token, url, name, preset);
    }
  }

  public DownloadYtFile(url: string, quality: string, audioOnly: boolean) {
    if (token) {
      hubConnection.invoke('DownloadYtVideo', token, url, quality, audioOnly);
    }
  }

  public GetYtQuality(url: string) {
    if (token) {
      return this.http.get<number[]>(baseUrl + "api/video/getYoutubeQuality?url=" + url + "&token=" + token);
    }
  }

  public ChangeDownload(fileId: number, fileName: string) {
    if (token) {
      hubConnection.invoke('ChangeDownload', token, fileId, fileName);
    }
  }

  public GetDownloads() {
    if (token) {
      hubConnection.invoke('GetDownloads', token);
    }
  }

  public GetFolders(folderId: number = 1) {
    if (token) {
      hubConnection.invoke('GetFolders', token, folderId);
    }
  }

  public AddFolder(folderId: number) {
    if (token) {
      hubConnection.invoke('AddFolder', token, folderId);
    }
  }

  public ShareFolder(folderId: number, userId: number) {
    if (token) {
      hubConnection.invoke('ShareFolder', token, folderId, userId);
    }
  }

  public DeleteFolder(folderId: number) {
    if (token) {
      hubConnection.invoke('DeleteFolder', token, folderId);
    }
  }

  public ChangeFolderName(folderId: number, folderName: string) {
    if (token) {
      hubConnection.invoke('ChangeFolderName', token, folderId, folderName);
    }
  }

  public GetFolderFiles(folderId: number) {
    if (token) {
      hubConnection.invoke('GetFolderFiles', token, folderId);
    }
  }

  public ChangeFolder(fileId: number, folderId: number) {
    if (token) {
      hubConnection.invoke('ChangeFolder', token, fileId, folderId);
    }
  }

  public CancelM3U8Download(downloadId: string) {
    if (token) {
      hubConnection.invoke('CancelConversion', token, downloadId);
    }
  }

  public GetFileInfo(id: number) {
    if (token) {
      hubConnection.invoke('GetFileInfo', token, id);
    }
  }

  public RemoveFile(id: number) {
    if (token) {
      hubConnection.invoke('RemoveFile', token, id);
    }
  }

  public MakeFilePermanent(id: number) {
    if (token) {
      hubConnection.invoke('MakeFilePermanent', token, id);
    }
  }

  public addUpdateFolderServerRequestListener() {
    hubConnection.on('updateFolders', (data) => {
      this.updateFolder.next(data);
    });
  }

  public removeUpdateFolderServerRequestListener() {
    hubConnection.off('updateFolders', (data) => {
    });
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
