import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { BlackjackDealer, BlackjackMember } from '../Interfaces/Games/blackjack';
import { BlackjackService } from './blackjack-service/blackjack-service.service';
declare var $: any;

@Component({
  selector: 'app-blackjack-game',
  templateUrl: './blackjack-game.component.html',
  styleUrls: ['./blackjack-game.component.scss']
})
export class BlackjackGameComponent implements OnInit, OnDestroy {

  @Input() UniqueId = "";
  constructor(private blackjackService: BlackjackService) { }
  BetAmount = 5;
  dealer: BlackjackDealer;
  self: BlackjackMember;
  members: BlackjackMember[] = [];
  doubleOption = true;
  askBetUpdate;
  askPullUpdate;
  dealerUpdate;
  selfUpdate;
  memberUpdate;
  betModalTimeout;
  pullModalTimeout;
  timeoutTime = 60000;
  timeoutTimer = 60;
  timeoutInterval;

  ngOnInit(): void {
    this.timeoutInterval = setInterval(() => {
      if (this.timeoutTimer > 0) {
        this.timeoutTimer--;
      }
    }, 1000)
    this.askBetUpdate = this.blackjackService.askBetUpdate.subscribe(askBet => {
      if (askBet === true) {
        this.timeoutTimer = 60;
        $('#bjBetModal').modal('show');
        this.betModalTimeout = setTimeout(() => {   
          console.log("Now bet");     
          this.BetAmount = 5;      
          this.blackjackService.setBet(this.UniqueId, this.BetAmount);
          $('#bjBetModal').modal('hide');
          clearTimeout(this.betModalTimeout); 
        }, this.timeoutTime);
      }
    });
    this.askPullUpdate = this.blackjackService.askPullUpdate.subscribe(askPull => {
      if (askPull === null) {
        return;
      }
      this.timeoutTimer = 60;
      this.doubleOption = askPull;
      $('#bjPullModal').modal('show');
      this.pullModalTimeout = setTimeout(() => {   
        console.log("Now pull");     
        this.blackjackService.pull(this.UniqueId, false, false);
        $('#bjPullModal').modal('hide');
        clearTimeout(this.pullModalTimeout);
      }, this.timeoutTime);
    });
    this.dealerUpdate = this.blackjackService.dealerUpdate.subscribe(dealer => {
      if (dealer === null) {
        return;
      }
      this.dealer = dealer;
    });
    this.selfUpdate = this.blackjackService.selfUpdate.subscribe(self => {
      if (self === null) {
        return;
      }
      this.self = self;
    });
    this.memberUpdate = this.blackjackService.membersUpdate.subscribe(members => {
      if (members === null) {
        return;
      }
      this.members = members;
    });
  }

  ngOnDestroy() {
    clearInterval(this.timeoutInterval);
    this.askBetUpdate.unsubscribe();
    this.askPullUpdate.unsubscribe();
    this.dealerUpdate.unsubscribe();
    this.selfUpdate.unsubscribe();
    this.memberUpdate.unsubscribe();
  }

  SetBet() {
    if (this.BetAmount >= 5 && this.BetAmount <= 200 && this.BetAmount < this.self.money) {
      clearTimeout(this.betModalTimeout);
      var amount = (Math.round(this.BetAmount * 10)/10).toFixed(1);
      this.BetAmount = Number(amount);
      this.blackjackService.setBet(this.UniqueId, this.BetAmount);
      $('#bjBetModal').modal('hide');
    }
  }

  Pull(doPull, doDouble) {
    clearTimeout(this.pullModalTimeout);
    this.blackjackService.pull(this.UniqueId, doPull, doDouble);
    $('#bjPullModal').modal('hide');
  }

}
