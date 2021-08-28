import {
  Component,
  Input,
  OnDestroy,
  OnInit
} from '@angular/core';
import {
  BlackjackDealer,
  BlackjackMember
} from '../Interfaces/Games/blackjack';
import {
  PlayerService
} from '../player/player-service/player.service';
import {
  BlackjackService
} from './blackjack-service/blackjack-service.service';
declare var $: any;

@Component({
  selector: 'app-blackjack-game',
  templateUrl: './blackjack-game.component.html',
  styleUrls: ['./blackjack-game.component.scss']
})
export class BlackjackGameComponent implements OnInit, OnDestroy {

  @Input() UniqueId = "";
  @Input() logout = false;;
  constructor(private blackjackService: BlackjackService, private playerService: PlayerService) {}
  BetAmount = 5;
  dealer: BlackjackDealer;
  self: BlackjackMember;
  members: BlackjackMember[] = [];
  newMessage = false;
  doubleOption = true;
  askBetUpdate;
  askPullUpdate;
  askSplitPullUpdate;
  dealerUpdate;
  selfUpdate;
  memberUpdate;
  betModalTimeout;
  pullModalTimeout;
  timeoutTime = 60000;
  timeoutTimer = 60;
  PercentTimer = 0;
  timeoutInterval;
  playingBlackjack;
  autoBet = false;
  forSplitHand = undefined;

  filteredMembers() {
    return this.members.filter(x => !x.notPlaying)
  } 

  ngOnInit(): void {
    this.askBetUpdate = this.blackjackService.askBetUpdate.subscribe(askBet => {
      if (askBet === true) {
        this.ResetView();
        this.forSplitHand = undefined
        if (!this.autoBet) {
          setTimeout(() => {            
            $('#BetCollapse').collapse('show');
          }, 250);
          this.betModalTimeout = setTimeout(() => {
            this.BetAmount = 5;
            $('#BetCollapse').collapse('hide');
            clearTimeout(this.betModalTimeout);
          }, this.timeoutTime);
        } else {
          setTimeout(() => {            
            this.SetBet();
          }, 250);
        }
      }
    });
    this.askPullUpdate = this.blackjackService.askPullUpdate.subscribe(askPull => {
      if (askPull === null) {
        return;
      }
      this.ResetView();
      this.doubleOption = askPull;
      $('#PullCollapse').collapse('show');
      this.pullModalTimeout = setTimeout(() => {
        $('#PullCollapse').collapse('hide');
        clearTimeout(this.pullModalTimeout);
      }, this.timeoutTime);
    });
    this.askSplitPullUpdate = this.blackjackService.askSplitPullUpdate.subscribe(forSplitHand => {
      if (forSplitHand === null) {
        return;
      }
      this.ResetView();
      this.forSplitHand = forSplitHand;
      $('#PullCollapse').collapse('show');
      this.pullModalTimeout = setTimeout(() => {
        $('#PullCollapse').collapse('hide');
        clearTimeout(this.pullModalTimeout);
      }, this.timeoutTime);
    });
    this.playingBlackjack = this.playerService.playingBlackjack.subscribe(playBlackjack => {
      if (playBlackjack == null) {
        return;
      }
      if (playBlackjack === true) {
        clearInterval(this.timeoutInterval);
        this.timeoutInterval = setInterval(() => {
          if (this.timeoutTimer > 0) {
            this.timeoutTimer--;
            this.PercentTimer = 100 - (this.timeoutTimer / 60 * 100);
          }
        }, 1000)
      }
      if (playBlackjack === false) {
        clearInterval(this.timeoutInterval);
        clearTimeout(this.pullModalTimeout);
        clearTimeout(this.betModalTimeout);
      }
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
    clearTimeout(this.pullModalTimeout);
    clearTimeout(this.betModalTimeout);
    this.askBetUpdate.unsubscribe();
    this.playingBlackjack.unsubscribe();
    this.askPullUpdate.unsubscribe();
    this.askSplitPullUpdate.unsubscribe();
    this.dealerUpdate.unsubscribe();
    this.selfUpdate.unsubscribe();
    this.memberUpdate.unsubscribe();
    this.blackjackService.pushAllNull();
  }

  ResetView() {
    this.timeoutTimer = 60;
    this.PercentTimer = 0;
    clearTimeout(this.pullModalTimeout);
    clearTimeout(this.betModalTimeout);
    $('#BetCollapse').collapse('hide');
    $('#PullCollapse').collapse('hide');
  }

  SetBet() {
    if (this.self.waitingForBet) {
      this.self.waitingForBet = false;
      if (this.BetAmount < 5)
      this.BetAmount = 5;
      if (this.BetAmount > 200)
        this.BetAmount = 200;
      if (this.BetAmount > this.self.money)
        this.BetAmount = this.self.money;
      if (this.BetAmount > 0) {
        clearTimeout(this.betModalTimeout);
        var amount = (Math.round(this.BetAmount * 10) / 10).toFixed(1);
        this.BetAmount = Number(amount);
        this.blackjackService.setBet(this.UniqueId, this.BetAmount);
        $('#BetCollapse').collapse('hide');
      }
    }
  }

  Pull(doPull, doDouble, doSplit) {
    if (this.self.waitingForPull) {
      this.self.waitingForPull = false;
      clearTimeout(this.pullModalTimeout);
      if (this.forSplitHand === undefined) {
        this.blackjackService.pull(this.UniqueId, doPull, doDouble, doSplit);
      } else {
        this.blackjackService.splitpull(this.UniqueId, doPull, this.forSplitHand);
      }
      $('#PullCollapse').collapse('hide');
    }
  }

  checkChatClass() {
    var hasClass = !($('#ChatCollapse').hasClass('show'));
    return hasClass;
  }

  SetAutoBet() {
    this.autoBet = !this.autoBet;
    if (this.autoBet&&this.self.waitingForBet) {
      this.SetBet();
    }
  }
}
