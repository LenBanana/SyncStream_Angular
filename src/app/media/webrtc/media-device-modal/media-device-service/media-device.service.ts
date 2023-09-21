import {Injectable} from '@angular/core';
import {WebRtcSettings} from "../../webrtc-service/webrtc.service";

@Injectable({
  providedIn: 'root'
})
export class MediaDeviceService {

  constructor() {
  }

  async getDevice(settings: WebRtcSettings): Promise<MediaStream> {
    const screenCaptureOptions = settings.shareScreen ? {
      video: {
        height: {ideal: settings.idealResolution},
        frameRate: {ideal: settings.idealFrameRate}
      }
    } : {};

    const audioCaptureOptions = settings.shareMicrophone ? {audio: true} : {};

    let combinedStream = new MediaStream();

    if (settings.shareScreen) {
      const screenStream = await navigator.mediaDevices.getDisplayMedia(screenCaptureOptions);
      screenStream.getTracks().forEach(track => combinedStream.addTrack(track));
    }

    if (settings.shareMicrophone) {
      const audioStream = await navigator.mediaDevices.getUserMedia(audioCaptureOptions);
      audioStream.getTracks().forEach(track => combinedStream.addTrack(track));
    }

    return combinedStream;
  }

  async requestScreenCapturePermission(): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getDisplayMedia({video: true});
    } catch (error) {
      console.error('Permission denied or error accessing screen capture.', error);
      throw error;
    }
  }

  async getVideoDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput');
  }

  async getDeviceStream(deviceId: string): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({video: {deviceId: deviceId}});
  }
}
