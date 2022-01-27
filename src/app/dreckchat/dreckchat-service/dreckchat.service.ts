import { Injectable } from '@angular/core';
import * as signalR from "@aspnet/signalr";
import { ChatMessage } from '../../Interfaces/Chatmessage';
import { BehaviorSubject } from 'rxjs';
import { hubConnection, baseUrl, SignalRService } from '../../services/signal-r.service';
import { HttpClient } from '@angular/common/http';
import { Language } from 'src/app/Interfaces/Language';

@Injectable({
  providedIn: 'root'
})
export class DreckchatService {

  messages: BehaviorSubject<ChatMessage[]> = new BehaviorSubject([]);
  message: BehaviorSubject<ChatMessage> = new BehaviorSubject(null);
  constructor(private http: HttpClient, private signalRService: SignalRService) {
    signalRService.connectionClosed.subscribe(isClosed => {
      if (isClosed===false) {
        this.addMessageListener();
        this.addMessagesListener();
      }
      if (isClosed===true) {
        this.removeMessageListener();
        this.removeMessagesListener();
      }
    });
   }

   public NullAllSubs() {
    this.messages.next(null);
    this.message.next(null);
   }

  public addMessagesListener() {
    hubConnection.on('sendmessages', (data) => {
      this.messages.next(data);
    })
  }

  public removeMessagesListener() {
    hubConnection.off('sendmessages');
    this.messages.next(null);
  }

  public addMessageListener() {
    hubConnection.on('sendmessage', (data) => {
      this.message.next(data);
    })
  }

  public removeMessageListener() {
    hubConnection.off('sendmessage');
    this.message.next(null);
  }

  public sendMessage(message: ChatMessage, UniqueId: string) {
    hubConnection.invoke('SendMessage', message, UniqueId);
  }

  public getMessages(UniqueId: string) {
    hubConnection.invoke('GetMessages', UniqueId);
  }

  public clearChat(UniqueId: string) {
    hubConnection.invoke('ClearChat', UniqueId);
  }

  public playGallows(UniqueId: string, language: Language, drawTime: number = 90) {
    hubConnection.invoke('PlayGallows', UniqueId, language, drawTime);
  }

  public playBlackjack(UniqueId: string) {
    hubConnection.invoke('PlayBlackjack', UniqueId);
  }

  public spectateBj(UniqueId: string) {
    hubConnection.invoke('SpectateBlackjack', UniqueId);
  }

  public AddBjAi(UniqueId: string) {
    hubConnection.invoke('AddBlackjackAi', UniqueId);
  }

  public MakeAi(UniqueId: string) {
    hubConnection.invoke('MakeAi', UniqueId);
  }
}
