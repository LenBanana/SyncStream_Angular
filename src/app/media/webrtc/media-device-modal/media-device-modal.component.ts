import {Component, OnInit} from '@angular/core';
import {MediaDeviceService} from "./media-device-service/media-device.service";

declare var $: any;

@Component({
  selector: 'app-media-device-modal',
  templateUrl: './media-device-modal.component.html',
  styleUrls: ['./media-device-modal.component.scss']
})
export class MediaDeviceModalComponent implements OnInit {
  devices: MediaDeviceInfo[] = [];
  streams: { [deviceId: string]: MediaStream } = {};

  constructor(private mediaService: MediaDeviceService) {
  }

  async ngOnInit() {
    try {
      await this.mediaService.requestScreenCapturePermission();
      this.devices = await this.mediaService.getVideoDevices();
      for (const device of this.devices) {
        this.streams[device.deviceId] = await this.mediaService.getDeviceStream(device.deviceId);
      }
    } catch (error) {
      console.error('Error initializing devices:', error);
      // Handle the error, e.g., show a message to the user
    }
  }

  selectDevice(deviceId: string) {
    console.log('Selected device:', deviceId);
  }

}
