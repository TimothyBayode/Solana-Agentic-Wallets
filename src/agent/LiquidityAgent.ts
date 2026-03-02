import { Connection } from "@solana/web3.js";
import { AgentWallet } from "../wallet/AgentWallet";
import { BaseAgent, AgentAction } from "./BaseAgent";

export interface LiquidityAgentConfig {
  poolAddress: string;
  targetRatio: number;       // 0–1, desired SOL ratio in pool
  rebalanceThreshold: number; // deviation to trigger rebalance
  depositAmountSOL: number;
}

export class LiquidityAgent extends BaseAgent {
  private config: LiquidityAgentConfig;
  private simulatedPoolRatio: number;
  private feesEarned: number = 0;

  constructor(wallet: AgentWallet, connection: Connection, config: LiquidityAgentConfig) {
    super(wallet, connection);
    this.config = config;
    // Simulate initial pool state
    this.simulatedPoolRatio = 0.5 + (Math.random() - 0.5) * 0.3;
  }

  protected async decideAndAct(): Promise<AgentAction | null> {
    // Simulate pool drift each cycle
    this.simulatedPoolRatio += (Math.random() - 0.5) * 0.05;
    this.simulatedPoolRatio = Math.max(0.1, Math.min(0.9, this.simulatedPoolRatio));

    const deviation = Math.abs(this.simulatedPoolRatio - this.config.targetRatio);
    const balance = this.state.balanceSOL;

    this.log(
      `Pool ratio: ${this.simulatedPoolRatio.toFixed(3)} | ` +
      `Target: ${this.config.targetRatio} | Deviation: ${deviation.toFixed(3)}`
    );

    // Accrue simulated fees
    this.feesEarned += 0.00001 * balance;

    if (deviation < this.config.rebalanceThreshold) {
      return this.recordAction("OBSERVE", {
        poolRatio: this.simulatedPoolRatio,
        deviation,
        feesEarned: this.feesEarned,
      });
    }

    if (balance < this.config.depositAmountSOL + 0.001) {
      this.log("Insufficient balance to rebalance");
      return this.recordAction("SKIP", { reason: "insufficient_balance" });
    }

    this.log(`Rebalancing: depositing ${this.config.depositAmountSOL} SOL to pool`);

    const result = await this.wallet.transferSOL(
      this.connection,
      this.config.poolAddress,
      this.config.depositAmountSOL
    );

    // Simulate ratio correction
    if (result.success) {
      this.simulatedPoolRatio = this.config.targetRatio + (Math.random() - 0.5) * 0.02;
    }

    return this.recordAction("REBALANCE", {
      poolRatio: this.simulatedPoolRatio,
      depositAmount: this.config.depositAmountSOL,
      feesEarned: this.feesEarned,
    }, result);
  }

  getFeesEarned(): number {
    return this.feesEarned;
  }

  getPoolRatio(): number {
    return this.simulatedPoolRatio;
  }
}
