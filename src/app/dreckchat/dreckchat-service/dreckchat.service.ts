import { Injectable } from '@angular/core';
import * as signalR from "@aspnet/signalr";
import { ChatMessage } from '../../Interfaces/Chatmessage';
import { BehaviorSubject } from 'rxjs';
import { hubConnection, baseUrl } from '../../services/signal-r.service';
import { HttpClient } from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class DreckchatService {

  messages: BehaviorSubject<ChatMessage[]> = new BehaviorSubject([]);
  message: BehaviorSubject<ChatMessage> = new BehaviorSubject(null);
  constructor(private http: HttpClient) { }

  public addMessagesListener() {
    hubConnection.on('sendmessages', (data) => {
      this.messages.next(data);
    })
  }

  public removeMessagesListener() {
    hubConnection.off('sendmessages', (data) => {
    });
  }

  public addMessageListener() {
    hubConnection.on('sendmessage', (data) => {
      this.message.next(data);
    })
  }

  public removeMessageListener() {
    hubConnection.off('sendmessage', (data) => {
    });
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

  public playGallows(UniqueId: string) {
    hubConnection.invoke('PlayGallows', UniqueId);
  }

  public async HttpGetMessages(UniqueId: string) {
    this.http.get(baseUrl + 'api/Server/GetMessages/?UniqueId=' + UniqueId)
      .subscribe(res => {
      })
  }
}
