import {Injectable, OnDestroy} from '@angular/core';
import {BehaviorSubject} from 'rxjs';
import {SignalRService, hubConnection} from '../../../services/signal-r.service';

import {WebrtcService} from "../../webrtc/webrtc-service/webrtc.service";
import {WebRtcSettings} from "../../../Interfaces/BrowserSettings";

@Injectable({
  providedIn: 'root'
})
export class WebrtcVoipService implements OnDestroy {
  public peerConnections: Map<string, RTCPeerConnection> = new Map();
  public gatheredIceCandidates: Map<string, RTCIceCandidate[]> = new Map();
  public onNewParticipant: BehaviorSubject<VoipParticipant> = new BehaviorSubject(null);
  public onParticipantLeave: BehaviorSubject<VoipParticipant> = new BehaviorSubject(null);
  public joinRoom: BehaviorSubject<string> = new BehaviorSubject(null);
  public leaveRoom: BehaviorSubject<string> = new BehaviorSubject(null);
  public peerStatus: BehaviorSubject<VoipParticipantDTO> = new BehaviorSubject(null);
  public localStream: MediaStream;

  constructor(private signalRService: SignalRService, private webRtcService: WebrtcService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed === false) {
        this.addListeners();
      }
      if (isClosed === true) {
        this.removeListeners();
      }
    });
  }

  ngOnDestroy(): void {
    this.cleanUp();
    this.removeListeners();
  }

  async addVideoTrackToConnection(stream: MediaStreamTrack) {
    this.localStream.addTrack(stream);
    this.peerConnections.forEach((pc, participantId) => {
      pc.addTrack(stream, this.localStream);
    });
  }

  async removeVideoTrackFromConnection() {
    const videoTracks = this.localStream.getVideoTracks();
    videoTracks.forEach(track => {
      this.localStream.removeTrack(track);
      this.peerConnections.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          pc.removeTrack(sender);
        }
      });
      track.stop();
    });
  }

  async replaceVideoTrack(cameraId: string, videoSettings: WebRtcSettings) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: cameraId,
        width: videoSettings.playerWidth,
        frameRate: videoSettings.idealFrameRate
      }
    });
    const videoTracks = this.localStream.getVideoTracks();
    videoTracks.forEach(track => {
      this.localStream.removeTrack(track);
      track.stop();
    });
    stream.getVideoTracks().forEach(track => {
      this.localStream.addTrack(track);
    });
    this.peerConnections.forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(stream.getVideoTracks()[0]);
      }
    });
  }

  async replaceAudioTrack(microphoneId: string) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: microphoneId
      }
    });
    const audioTracks = this.localStream.getAudioTracks();
    audioTracks.forEach(track => {
      this.localStream.removeTrack(track);
      track.stop();
    });
    stream.getAudioTracks().forEach(track => {
      this.localStream.addTrack(track);
    });
    this.peerConnections.forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
      if (sender) {
        sender.replaceTrack(stream.getAudioTracks()[0]);
      }
    });
  }

  async joinAudioRoom(roomName: string, localStream: MediaStream) {
    try {
      this.localStream = localStream;
      await hubConnection.invoke('JoinAudioRoom', roomName);
    } catch (error) {
      console.error('Error joining audio room:', error);
    }
  }

  async leaveAudioRoom(roomName: string) {
    try {
      await hubConnection.invoke('LeaveAudioRoom', roomName);
      // Close all peer connections
      this.peerConnections.forEach(pc => pc.close());
      this.peerConnections.clear();
    } catch (error) {
      console.error('Error leaving audio room:', error);
    }
  }

  async sendStatus(participant: VoipParticipantDTO, roomName: string) {
    await hubConnection.invoke('SendStatusToParticipant', participant, roomName);
  }

  async createAndSendOffer(pc: RTCPeerConnection, participant: string) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const voipOffer: VoipOffer = {
        participantName: participant,
        type: pc.localDescription.type,
        sdp: pc.localDescription.sdp
      };
      await hubConnection.invoke('SendOfferToParticipant', participant, voipOffer);
    } catch (error) {
      console.error('Error creating and sending offer:', error);
    }
  }

  private async createPeerConnection(participant: VoipParticipantDTO, localStream: MediaStream): Promise<RTCPeerConnection> {
    const configuration = await this.webRtcService.getWebRtcConfig();
    const pc = new RTCPeerConnection(configuration);

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onnegotiationneeded = async () => {
      await this.createAndSendOffer(pc, participant.participantId);
    };

    pc.onicecandidate = event => {
      if (event.candidate ) {
        try {
          hubConnection.invoke('SendIceCandidateToParticipant', participant.participantId, event.candidate);
        } catch (error) {
          console.error('Error sending ICE candidate:', error);
        }
      }
    };

    pc.onconnectionstatechange = async event => {
      if (pc.connectionState === 'failed') {
        // Attempt ICE restart before giving up — common when switching networks or NAT rebinds.
        const iceState = pc.iceConnectionState;
        if (iceState === 'failed' || iceState === 'disconnected') {
          try {
            console.warn(`ICE failed for ${participant.participantId}, attempting restart`);
            const offer = await pc.createOffer({iceRestart: true});
            await pc.setLocalDescription(offer);
            const voipOffer: VoipOffer = {
              participantName: participant.participantName,
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp
            };
            await hubConnection.invoke('SendOfferToParticipant', participant.participantId, voipOffer);
            return;
          } catch (restartError) {
            console.error('ICE restart failed, disconnecting peer:', restartError);
          }
        }
        this.handleParticipantLeave(participant.participantId);
      } else if (pc.connectionState === 'disconnected') {
        // 'disconnected' is transient — wait for it to recover or move to 'failed'/'closed'.
      } else if (pc.connectionState === 'closed') {
        this.handleParticipantLeave(participant.participantId);
      }
    };

    pc.onsignalingstatechange = async event => {
      if (pc.signalingState === 'have-remote-offer') {
        const offer = {
          participantName: participant.participantName,
          type: pc.remoteDescription.type,
          sdp: pc.remoteDescription.sdp
        };
        const gatheredIceCandidates = this.gatheredIceCandidates.get(participant.participantId);
        if (gatheredIceCandidates) {
          console.log('Adding gathered ICE candidates')
          gatheredIceCandidates.forEach(candidate => {
            pc.addIceCandidate(candidate).catch(error => {
              console.error('Error adding ICE candidate:', error);
            });
          });
          this.gatheredIceCandidates.delete(participant.participantId);
        }
        await this.createAndSendAnswer(pc, participant.participantId, offer);
      }
    };

    pc.ontrack = event => {
      if (participant.participantName) {
        const voipParticipant: VoipParticipant = {
          participantId: participant.participantId,
          stream: event.streams[0],
          participantName: participant.participantName
        };
        this.onNewParticipant.next(voipParticipant);
      }
    };

    return pc;
  }

  async initiateConnectionToParticipant(participant: VoipParticipantDTO, localStream: MediaStream) {
    let pc: RTCPeerConnection;
    if (!this.peerConnections.has(participant.participantId)) {
      pc = await this.createPeerConnection(participant, localStream);
      this.peerConnections.set(participant.participantId, pc);
    } else {
      pc = this.peerConnections.get(participant.participantId);
    }
    return pc;
  }

  async handleIncomingOffer(participantId: string, offer: VoipOffer) {
    let pc: RTCPeerConnection = await this.initiateConnectionToParticipant({
      participantId: participantId,
      participantName: offer.participantName
    }, this.localStream);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription({sdp: offer.sdp, type: offer.type as RTCSdpType}));
      await this.addGatheredIceCandidates(participantId);
      const existingSenders = pc.getSenders();
      this.localStream.getTracks().forEach(track => {
        const sender = existingSenders.find(s => s.track && s.track.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track);
        } else {
          pc.addTrack(track, this.localStream)
        }
      });
    } catch (error) {
      console.error('Error handling incoming offer:', error);
    }
  }

  async handleIncomingAnswer(participantId: string, answer: VoipOffer) {
    const pc = this.peerConnections.get(participantId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription({
        sdp: answer.sdp,
        type: answer.type as RTCSdpType
      })).catch(error => {
        console.error('Error setting remote description:', error);
      });
      await this.addGatheredIceCandidates(participantId);
    }
  }

  private async addGatheredIceCandidates(participantId: string) {
    const pc = this.peerConnections.get(participantId);
    if (!pc) return;

    const gatheredIceCandidates = this.gatheredIceCandidates.get(participantId);
    if (gatheredIceCandidates) {
      gatheredIceCandidates.forEach(candidate => {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(error => {
          console.error('Error adding ICE candidate:', error);
        });
      });
      // Remove the participant's entry from the map after adding the candidates
      this.gatheredIceCandidates.delete(participantId);
    }
  }

  async handleParticipantLeave(participantId: string) {
    const pc = this.peerConnections.get(participantId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(participantId);
      this.onParticipantLeave.next({
        participantId: participantId,
        stream: null,
        participantName: participantId
      });
    }
  }

  async createAndSendAnswer(pc: RTCPeerConnection, participantId: string, offer: VoipOffer) {
    try {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      const voipOffer: VoipOffer = {
        participantName: offer.participantName,
        type: answer.type,
        sdp: answer.sdp
      };
      await hubConnection.invoke('SendAnswerToParticipant', participantId, voipOffer);
    } catch (error) {
      console.error('Error creating and sending answer:', error);
    }
  }

  async handleIncomingIceCandidate(participantId: string, candidate) {
    let pc = this.peerConnections.get(participantId);
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      // Directly add the ICE candidate if the handshake is complete
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(error => {
        console.error('Error adding ICE candidate:', error);
      });
    } else {
      // Store the ICE candidate if the handshake is not complete
      if (!this.gatheredIceCandidates.has(participantId)) {
        this.gatheredIceCandidates.set(participantId, []);
      }
      this.gatheredIceCandidates.get(participantId).push(candidate);
    }
  }

  private addListeners() {
    hubConnection.on('participantJoined', (participant: VoipParticipantDTO) => {
      this.initiateConnectionToParticipant(participant, this.localStream);
    });

    hubConnection.on('participantLeft', (participant: VoipParticipantDTO) => {
      this.handleParticipantLeave(participant.participantId);
    });

    hubConnection.on('receiveOfferFromParticipant', (participantId, offer) => {
      this.handleIncomingOffer(participantId, offer);
    });

    hubConnection.on('receiveAnswerFromParticipant', (participantId, answer) => {
      this.handleIncomingAnswer(participantId, answer);
    });
    hubConnection.on('receiveIceCandidateFromParticipant', (participantId, candidate) => {
      this.handleIncomingIceCandidate(participantId, candidate);
    });
    hubConnection.on('receiveStatusFromParticipant', (participant: VoipParticipantDTO) => {
      this.peerStatus.next(participant);
    });
  }

  private removeListeners() {
    hubConnection.off('participantJoined');
    hubConnection.off('participantLeft');
    hubConnection.off('receiveOfferFromParticipant');
    hubConnection.off('receiveAnswerFromParticipant');
    hubConnection.off('receiveIceCandidateFromParticipant');
  }

  public cleanUp() {
    this.onNewParticipant.next(null);
    this.onParticipantLeave.next(null);
    this.joinRoom.next(null);
    this.leaveRoom.next(null);
  }

  async popOutVideo(videoElement: HTMLVideoElement, originalParent: HTMLElement) {
    const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
    if (isFirefox) {
      const screenWidth = window.screen.width;
      const initialWidth = Math.floor(screenWidth * 0.25);
      const initialHeight = Math.floor((initialWidth * 9) / 16);
      const popOutWindow = window.open('', 'Pop Out Video', `width=${initialWidth},height=${initialHeight}`);
      if (popOutWindow) {
        popOutWindow.document.body.appendChild(videoElement);
        videoElement.style.width = '100%';
        videoElement.style.height = '100%';
        popOutWindow.document.body.style.margin = '0';
        popOutWindow.document.body.style.padding = '0';
        popOutWindow.document.body.style.backgroundColor = '#222222';
        await videoElement.play();
        popOutWindow.addEventListener('unload', () => {
          originalParent.appendChild(videoElement);
          videoElement.style.width = '';
          videoElement.style.height = '';
        });
      }
    } else {
      if (document.pictureInPictureElement !== null && document.pictureInPictureElement === videoElement) {
        await document.exitPictureInPicture();
        return;
      }
      await videoElement.requestPictureInPicture();
    }
  }
}

export interface VoipParticipantDTO {
  participantId: string,
  participantName?: string
  isMuted?: boolean,
  isSpeaking?: boolean,
  isVideoMuted?: boolean,
  isScreenMuted?: boolean,
}

export interface VoipOffer {
  participantName: string,
  type: string,
  sdp: string
}

export interface VoipParticipant extends VoipParticipantDTO {
  stream: MediaStream
}
