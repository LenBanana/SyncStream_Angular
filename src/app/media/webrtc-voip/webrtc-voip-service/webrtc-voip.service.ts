import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';
import {SignalRService, hubConnection} from '../../../services/signal-r.service';
import {token} from '../../../global.settings';
import {WebrtcService} from "../../webrtc/webrtc-service/webrtc.service";

@Injectable({
  providedIn: 'root'
})
export class WebrtcVoipService {
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  public onNewParticipant: BehaviorSubject<VoipParticipant> = new BehaviorSubject(null);
  public onParticipantLeave: BehaviorSubject<VoipParticipant> = new BehaviorSubject(null);
  public joinRoom: BehaviorSubject<string> = new BehaviorSubject(null);
  public leaveRoom: BehaviorSubject<string> = new BehaviorSubject(null);
  public peerMuteStatus: BehaviorSubject<VoipParticipantDTO> = new BehaviorSubject(null);
  private localStream: MediaStream;

  constructor(private signalRService: SignalRService, private webRtcService: WebrtcService) {
    // Add listeners for SignalR events
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed === false) {
        this.addListeners();
      }
      if (isClosed === true) {
        this.removeListeners();
      }
    });
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

  async joinAudioRoom(roomName: string, localStream: MediaStream) {
    try {
      if (token) {
        this.localStream = localStream;
        const configuration = await this.webRtcService.getWebRtcConfig();
        await hubConnection.invoke('JoinAudioRoom', token, roomName);
      }
    } catch (error) {
      console.error('Error joining audio room:', error);
    }
  }

  async leaveAudioRoom(roomName: string) {
    try {
      if (token) {
        await hubConnection.invoke('LeaveAudioRoom', token, roomName);
      }
      // Close all peer connections
      this.peerConnections.forEach(pc => pc.close());
      this.peerConnections.clear();
    } catch (error) {
      console.error('Error leaving audio room:', error);
    }
  }

  async sendStatus(participant: VoipParticipantDTO, roomName: string) {
    if (token) {
      await hubConnection.invoke('SendStatusToParticipant', token, participant, roomName);
    }
  }

  async createAndSendOffer(pc: RTCPeerConnection, participant: string) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (token) {
        const voipOffer: VoipOffer = {
          participantName: participant,
          type: pc.localDescription.type,
          sdp: pc.localDescription.sdp
        };
        await hubConnection.invoke('SendOfferToParticipant', token, participant, voipOffer);
      }
    } catch (error) {
      console.error('Error creating and sending offer:', error);
    }
  }

  async initiateConnectionToParticipant(participant: VoipParticipantDTO, localStream: MediaStream) {
    let pc: RTCPeerConnection;

    if (this.peerConnections.has(participant.participantId)) {
      pc = this.peerConnections.get(participant.participantId);
    } else {
      const configuration = await this.webRtcService.getWebRtcConfig();
      pc = new RTCPeerConnection(configuration);
      this.peerConnections.set(participant.participantId, pc);

      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

      pc.onnegotiationneeded = async () => {
        console.log('onnegotiationneeded for participant');
        await this.createAndSendOffer(pc, participant.participantId);
      };

      pc.onicecandidate = event => {
        if (event.candidate && token) {
          try {
            hubConnection.invoke('SendIceCandidateToParticipant', token, participant.participantId, event.candidate);
          } catch (error) {
            console.error('Error sending ICE candidate:', error);
          }
        }
      };

      pc.ontrack = event => {
        const voipParticipant: VoipParticipant = {
          participantId: participant.participantId,
          stream: event.streams[0],
          participantName: participant.participantName
        };
        this.onNewParticipant.next(voipParticipant);
      };
    }

    // This part is now only necessary if you want to force sending an offer right away
    // Otherwise, the onnegotiationneeded event will handle it
    //await this.createAndSendOffer(pc, participant);
  }


  async handleParticipantLeave(participant: VoipParticipantDTO) {
    const pc = this.peerConnections.get(participant.participantId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(participant.participantId);
      this.onParticipantLeave.next({
        participantId: participant.participantId,
        stream: null,
        participantName: participant.participantName
      });
    }
  }

  async createAndSendAnswer(pc: RTCPeerConnection, participantId: string, offer: VoipOffer) {
    try {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (token) {
        const voipOffer: VoipOffer = {
          participantName: offer.participantName,
          type: answer.type,
          sdp: answer.sdp
        };
        await hubConnection.invoke('SendAnswerToParticipant', token, participantId, voipOffer);
      }
    } catch (error) {
      console.error('Error creating and sending answer:', error);
    }
  }

  async handleIncomingOffer(participantId: string, offer: VoipOffer) {
    let pc: RTCPeerConnection;

    if (this.peerConnections.has(participantId)) {
      pc = this.peerConnections.get(participantId);
    } else {
      const configuration = await this.webRtcService.getWebRtcConfig();
      pc = new RTCPeerConnection(configuration);
      this.peerConnections.set(participantId, pc);

      pc.onnegotiationneeded = async () => {
        console.log('onnegotiationneeded for offer');
        await this.createAndSendOffer(pc, participantId);
      };

      pc.onicecandidate = event => {
        if (event.candidate && token) {
          try {
            hubConnection.invoke('SendIceCandidateToParticipant', token, participantId, event.candidate);
          } catch (error) {
            console.error('Error sending ICE candidate:', error);
          }
        }
      };

      pc.ontrack = event => {
        this.onNewParticipant.next({participantId, stream: event.streams[0], participantName: offer.participantName});
      };
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription({sdp: offer.sdp, type: offer.type as RTCSdpType}));
      const existingSenders = pc.getSenders();
      this.localStream.getTracks().forEach(track => {
        const sender = existingSenders.find(s => s.track && s.track.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track);
        } else {
          pc.addTrack(track, this.localStream)
        }
      });
      if (pc.signalingState === 'stable') {
        await this.createAndSendOffer(pc, participantId);
      } else {
        await this.createAndSendAnswer(pc, participantId, offer);
      }
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
    }
  }

  handleIncomingIceCandidate(participantId: string, candidate: RTCIceCandidate) {
    const pc = this.peerConnections.get(participantId);
    if (pc) {
      pc.addIceCandidate(candidate).catch(error => {
        console.error('Error adding ICE candidate:', error);
      });
    }
  }

  private addListeners() {
    hubConnection.on('participantJoined', (participant: VoipParticipantDTO) => {
      this.initiateConnectionToParticipant(participant, this.localStream);
    });

    hubConnection.on('participantLeft', (participant: VoipParticipantDTO) => {
      this.handleParticipantLeave(participant);
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
      this.peerMuteStatus.next(participant);
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

  popOutVideo(videoElement: HTMLVideoElement, originalParent: HTMLElement) {
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
      popOutWindow.addEventListener('unload', () => {
        originalParent.appendChild(videoElement);
        videoElement.style.width = '';
        videoElement.style.height = '';
      });
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
