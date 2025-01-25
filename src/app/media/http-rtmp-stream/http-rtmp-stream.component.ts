import {Component, ViewChild} from '@angular/core';
import {HttpRtmpService} from "./http-rtmp-service/http-rtmp.service";

@Component({
  selector: 'app-http-rtmp-stream',
  templateUrl: './http-rtmp-stream.component.html',
  styleUrls: ['./http-rtmp-stream.component.scss']
})
export class HttpRtmpStreamComponent {
  mediaRecorder: any;
  chunks: any[] = [];
  @ViewChild("videoElement") videoElement: HTMLVideoElement;

  constructor(private rtmpService: HttpRtmpService) {}

  startCapture() {
    navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
      .then(stream => {
        this.videoElement.srcObject = stream;
        let options = {
          videoBitsPerSecond: 100000
        };
        this.mediaRecorder = new MediaRecorder(stream, options);

        this.mediaRecorder.ondataavailable = (event: any) => {
          if (event.data.size > 0) {
            console.log(event.data);
          }
        };

        // Start the MediaRecorder, and generate data events every 3 seconds
        this.mediaRecorder.start(1000);
      })
      .catch(error => {
        console.error("Error accessing media devices.", error);
      });
  }

  stopCapture() {
    this.mediaRecorder.stop();
  }
}
