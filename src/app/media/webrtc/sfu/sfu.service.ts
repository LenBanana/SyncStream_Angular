import {Injectable} from '@angular/core';
import {Device, types} from 'mediasoup-client';
import {hubConnection, SignalRService} from '../../../services/signal-r.service';
import {SfuNewProducerNotification, SfuReceiver, SfuSender} from './sfu-transports';

/**
 * The browser's side of the SFU: the mediasoup device, and every link to an SFU room.
 *
 * Producer announcements are routed here to the receiver of the room they belong to. They used to be handled by
 * each feature separately, keyed on whichever room id that feature happened to remember, so a stream, a file share
 * and the popout competed for the same events.
 */
@Injectable({
  providedIn: 'root'
})
export class SfuService {
  private device: types.Device | null = null;
  private deviceLoading: Promise<types.Device> | null = null;
  private readonly receivers = new Set<SfuReceiver>();

  constructor(signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed === false) this.addListeners();
      if (isClosed === true) this.removeListeners();
    });
  }

  /** The device, loaded with the router's capabilities on first use. They never change, so it is kept. */
  loadDevice(): Promise<types.Device> {
    if (this.device?.loaded) return Promise.resolve(this.device);
    if (!this.deviceLoading) {
      this.deviceLoading = (async () => {
        const routerRtpCapabilities = await hubConnection.invoke<types.RtpCapabilities>('GetRouterRtpCapabilities');
        const device = new Device();
        await device.load({routerRtpCapabilities});
        this.device = device;
        return device;
      })();
      this.deviceLoading.then(
        () => this.deviceLoading = null,
        () => this.deviceLoading = null);
    }
    return this.deviceLoading;
  }

  /** The video codecs this browser can send to the SFU. */
  async sendableCodecs(): Promise<types.RtpCodecCapability[]> {
    return (await this.loadDevice()).rtpCapabilities.codecs ?? [];
  }

  /** A link that sends into the SFU room once opened. */
  createSender(sfuRoomId: string): SfuSender {
    return new SfuSender(sfuRoomId, () => this.loadDevice());
  }

  /** A link that receives every track in the SFU room once opened. */
  createReceiver(sfuRoomId: string): SfuReceiver {
    const receiver = new SfuReceiver(sfuRoomId, () => this.loadDevice(), closed => this.receivers.delete(closed));
    this.receivers.add(receiver);
    return receiver;
  }

  private addListeners(): void {
    hubConnection.on('sfuNewProducer', (notification: SfuNewProducerNotification) => {
      this.receivers.forEach(receiver => {
        if (receiver.sfuRoomId === notification.roomId) receiver.producerAdded(notification);
      });
    });

    hubConnection.on('sfuProducerClosed', (sfuRoomId: string, producerId: string) => {
      this.receivers.forEach(receiver => {
        if (receiver.sfuRoomId === sfuRoomId) receiver.producerClosed(producerId);
      });
    });
  }

  private removeListeners(): void {
    hubConnection.off('sfuNewProducer');
    hubConnection.off('sfuProducerClosed');
  }
}
