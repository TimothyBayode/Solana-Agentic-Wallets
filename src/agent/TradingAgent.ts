import { Connection } from "@solana/web3.js";
import { AgentWallet } from "../wallet/AgentWallet";
import { BaseAgent, AgentAction } from "./BaseAgent";

export interface TradingAgentConfig {
  marketAddress: string;   // Recipient representing the "market"
  tradeThresholdSOL: number; // Min balance to trigger a trade
  tradeAmountSOL: number;    // Amount per trade
  strategy: "aggressive" | "conservative" | "random";
}

export class TradingAgent extends BaseAgent {
  private config: TradingAgentConfig;
  private tradeCount: number = 0;

  constructor(wallet: AgentWallet, connection: Connection, config: TradingAgentConfig) {
    super(wallet, connection);
    this.config = config;
  }

  protected async decideAndAct(): Promise<AgentAction | null> {
    const balance = this.state.balanceSOL;

    this.log(`Balance: ${balance.toFixed(4)} SOL | Strategy: ${this.config.strategy}`);

    // ── Decision logic ──────────────────────────────────────
    if (balance < this.config.tradeThresholdSOL) {
      this.log(`Balance too low to trade (need ${this.config.tradeThresholdSOL} SOL)`);
      return this.recordAction("SKIP", { reason: "insufficient_balance", balance });
    }

    const shouldTrade = this.evaluateStrategy(balance);

    if (!shouldTrade) {
      this.log("Strategy says: hold");
      return this.recordAction("HOLD", { balance, reason: "strategy_hold" });
    }

    // ── Execute trade ────────────────────────────────────────
    this.log(`Executing trade: sending ${this.config.tradeAmountSOL} SOL`);
    const result = await this.wallet.transferSOL(
      this.connection,
      this.config.marketAddress,
      this.config.tradeAmountSOL
    );

    this.tradeCount++;

    if (result.success) {
      this.log(`Trade executed ✓ sig: ${result.signature.slice(0, 16)}...`);
    } else {
      this.log(`Trade failed ✗ ${result.error}`);
    }

    return this.recordAction("TRADE", {
      to: this.config.marketAddress,
      amount: this.config.tradeAmountSOL,
      balanceBefore: balance,
      tradeNumber: this.tradeCount,
    }, result);
  }

  private evaluateStrategy(balance: number): boolean {
    switch (this.config.strategy) {
      case "aggressive":
        // Trade on every cycle if balance allows
        return balance >= this.config.tradeThresholdSOL;
      case "conservative":
        // Only trade every 3rd cycle
        return this.state.cycleCount % 3 === 0;
      case "random":
        // 40% chance per cycle
        return Math.random() < 0.4;
      default:
        return false;
    }
  }

  getTradeCount(): number {
    return this.tradeCount;
  }
}
