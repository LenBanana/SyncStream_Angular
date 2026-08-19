import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import { AlertType } from '../../Interfaces/Dialog';
import { DownloadFile, DownloadInfo, FileFolder } from '../../Interfaces/DownloadInfo';
import { hubConnection, baseUrl, SignalRService , logHubFailure} from '../../services/signal-r.service';
import { DialogService } from '../../text-dialog/text-dialog-service/dialog-service.service';
import { User } from '../../Interfaces/User';

interface RoomUploadSessionResult {
  statusCode: number;
  errorMessage?: string;
  uploadId?: string;
  state?: string;
  chunkSize: number;
  nextOffset: number;
  totalSize: number;
  fileKey?: string;
  playbackUrl?: string;
}

export interface RoomUploadProgressState {
  phase: 'uploading' | 'processing';
  uploadedBytes: number;
  totalBytes: number;
}

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
  folderShared: BehaviorSubject<User[]> = new BehaviorSubject(null);
  constructor(private signalRService: SignalRService, private http: HttpClient, private dialogService: DialogService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addFolderListener();
        this.addDownloadListener();
        this.addDownloadsListener();
        this.addFolderFileListener();
        this.addBrowserResultListener();
        this.addgetFolderUsersListener();
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
        this.removegetFolderUsersListener();
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
    hubConnection.invoke('CleanUpFiles', remove).catch(logHubFailure);
  }

  public UploadFile(file: File) {
    const formData: FormData = new FormData();
    formData.append('fileKey', file, file.name);
    return this.http.post(baseUrl + "api/video/addFile", formData, {
      reportProgress: true,
      observe: 'events'
    });
  }

  public async UploadRoomFileInChunks(
    file: File,
    uniqueId: string,
    onProgress: (state: RoomUploadProgressState) => void,
    onSessionCreated?: (uploadId: string) => void,
    abortSignal?: AbortSignal
  ): Promise<RoomUploadSessionResult> {
    const fileExt = file.name.includes('.') ? file.name.split('.').pop() : '';
    const startUrl = baseUrl
      + `api/video/roomUpload/start`
      + `?uniqueId=${encodeURIComponent(uniqueId)}`
      + `&name=${encodeURIComponent(file.name)}`
      + `&fileEnding=${encodeURIComponent(fileExt)}`
      + `&totalSize=${encodeURIComponent(file.size.toString())}`;

    const startResult = await this.fetchRoomUploadResult(startUrl, {
      method: 'POST',
      signal: abortSignal
    });

    if (!startResult || !startResult.uploadId || startResult.statusCode >= 400) {
      return startResult;
    }

    const uploadId = startResult.uploadId;
    if (onSessionCreated) {
      onSessionCreated(uploadId);
    }
    let nextOffset = startResult.nextOffset || 0;
    const chunkSize = startResult.chunkSize || 8 * 1024 * 1024;

    while (nextOffset < file.size) {
      const chunk = file.slice(nextOffset, nextOffset + chunkSize);
      const chunkUrl = baseUrl
        + `api/video/roomUpload/chunk`
        + `?uploadId=${encodeURIComponent(uploadId)}`
        + `&startByte=${encodeURIComponent(nextOffset.toString())}`;

      const chunkResult = await this.sendChunkWithRetry(chunkUrl, uploadId, chunk, nextOffset, abortSignal);
      if (!chunkResult || chunkResult.statusCode >= 400) {
        return chunkResult;
      }

      nextOffset = chunkResult.nextOffset;
      onProgress({ phase: 'uploading', uploadedBytes: nextOffset, totalBytes: file.size });
    }

    onProgress({ phase: 'processing', uploadedBytes: file.size, totalBytes: file.size });

    const completeUrl = baseUrl
      + `api/video/roomUpload/complete`
      + `?uploadId=${encodeURIComponent(uploadId)}`;
    let completeResult = await this.fetchRoomUploadResult(completeUrl, {
      method: 'POST',
      signal: abortSignal
    });

    while (completeResult && completeResult.state === 'processing') {
      await this.delay(1500);
      completeResult = await this.GetRoomUploadStatus(uploadId, abortSignal);
    }

    return completeResult;
  }

  public async CancelRoomUpload(uploadId: string) {
    if (!uploadId) {
      return;
    }

    const url = baseUrl
      + `api/video/roomUpload/cancel`
      + `?uploadId=${encodeURIComponent(uploadId)}`;

    try {
      await this.fetchRoomUploadResult(url, { method: 'DELETE' });
    } catch {
      // Best effort cleanup on cancellation.
    }
  }

  private async GetRoomUploadStatus(uploadId: string, abortSignal?: AbortSignal): Promise<RoomUploadSessionResult> {
    const statusUrl = baseUrl
      + `api/video/roomUpload/status`
      + `?uploadId=${encodeURIComponent(uploadId)}`;

    return await this.fetchRoomUploadResult(statusUrl, {
      method: 'GET',
      signal: abortSignal
    });
  }

  private async sendChunkWithRetry(
    url: string,
    uploadId: string,
    chunk: Blob,
    startOffset: number,
    abortSignal?: AbortSignal
  ): Promise<RoomUploadSessionResult> {
    let lastError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await this.fetchRoomUploadResult(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunk,
          signal: abortSignal
        });

        if (result.statusCode === 409) {
          const status = await this.GetRoomUploadStatus(uploadId, abortSignal);
          if (status.nextOffset > startOffset) {
            return status;
          }
        }

        return result;
      } catch (err) {
        lastError = err;
        if (abortSignal?.aborted) {
          throw err;
        }
        await this.delay(500 * (attempt + 1));
      }
    }

    if (lastError) {
      throw lastError;
    }

    return await this.GetRoomUploadStatus(uploadId, abortSignal);
  }

  private async fetchRoomUploadResult(url: string, init: RequestInit): Promise<RoomUploadSessionResult> {
    const response = await fetch(url, init);
    let payload: RoomUploadSessionResult = null;

    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!payload) {
      payload = {
        statusCode: response.status,
        errorMessage: response.ok ? null : response.statusText,
        chunkSize: 0,
        nextOffset: 0,
        totalSize: 0
      };
    }

    payload.statusCode = response.status;
    if (!response.ok && !payload.errorMessage) {
      payload.errorMessage = response.statusText;
    }

    return payload;
  }

  private async delay(ms: number) {
    await new Promise(resolve => setTimeout(resolve, ms));
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
    hubConnection.invoke('DownloadFile', url, name, preset).catch(logHubFailure);
  }

  public DownloadYtFile(url: string, quality: string, audioOnly: boolean, downloadSubtitles: boolean) {
    hubConnection.invoke('DownloadYtVideo', url, quality, audioOnly, downloadSubtitles).catch(logHubFailure);
  }

  public GetYtQuality(url: string) {
    return this.http.get<number[]>(baseUrl + "api/video/getYoutubeQuality?url=" + encodeURIComponent(url));
  }

  public ChangeDownload(fileId: number, fileName: string) {
    hubConnection.invoke('ChangeDownload', fileId, fileName).catch(logHubFailure);
  }

  public GetDownloads() {
    hubConnection.invoke('GetDownloads').catch(logHubFailure);
  }

  public GetFolders(folderId: number = 1) {
    hubConnection.invoke('GetFolders', folderId).catch(logHubFailure);
  }

  public AddFolder(folderId: number) {
    hubConnection.invoke('AddFolder', folderId).catch(logHubFailure);
  }

  public ShareFolder(folderId: number, userId: number) {
    hubConnection.invoke('ShareFolder', folderId, userId).catch(logHubFailure);
  }

  public GetFolderUsers(folderId: number) {
    hubConnection.invoke('GetFolderUsers', folderId).catch(logHubFailure);
  }

  public DeleteFolder(folderId: number) {
    hubConnection.invoke('DeleteFolder', folderId).catch(logHubFailure);
  }

  public ChangeFolderName(folderId: number, folderName: string) {
    hubConnection.invoke('ChangeFolderName', folderId, folderName).catch(logHubFailure);
  }

  public GetFolderFiles(folderId: number) {
    hubConnection.invoke('GetFolderFiles', folderId).catch(logHubFailure);
  }

  public ChangeFolder(fileId: number, folderId: number) {
    hubConnection.invoke('ChangeFolder', fileId, folderId).catch(logHubFailure);
  }

  public CancelM3U8Download(downloadId: string) {
    hubConnection.invoke('CancelConversion', downloadId).catch(logHubFailure);
  }

  public GetFileInfo(id: number) {
    hubConnection.invoke('GetFileInfo', id).catch(logHubFailure);
  }

  public RemoveFile(id: number) {
    hubConnection.invoke('RemoveFile', id).catch(logHubFailure);
  }

  public MakeFilePermanent(id: number) {
    hubConnection.invoke('MakeFilePermanent', id).catch(logHubFailure);
  }

  public ToggleFilePublic(id: number) {
    hubConnection.invoke('ToggleFilePublic', id).catch(logHubFailure);
  }

  public addgetFolderUsersListener() {
    hubConnection.on('getFolderUsers', (data) => {
      this.folderShared.next(data);
    });
  }

  public removegetFolderUsersListener() {
    hubConnection.off('getFolderUsers', (data) => {
    });
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
