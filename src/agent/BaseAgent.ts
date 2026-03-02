import { Connection } from "@solana/web3.js";
import { AgentWallet, TransactionResult } from "../wallet/AgentWallet";

export type AgentStatus = "idle" | "running" | "paused" | "stopped" | "error";

export interface AgentAction {
  type: string;
  params: Record<string, any>;
  timestamp: string;
  result?: TransactionResult;
}

export interface AgentState {
  agentId: string;
  status: AgentStatus;
  cycleCount: number;
  lastAction?: AgentAction;
  actionHistory: AgentAction[];
  publicKey: string;
  balanceSOL: number;
}

export abstract class BaseAgent {
  protected wallet: AgentWallet;
  protected connection: Connection;
  protected state: AgentState;
  private intervalHandle?: NodeJS.Timeout;

  constructor(wallet: AgentWallet, connection: Connection) {
    this.wallet = wallet;
    this.connection = connection;
    this.state = {
      agentId: wallet.getInfo().agentId,
      status: "idle",
      cycleCount: 0,
      actionHistory: [],
      publicKey: wallet.publicKey,
      balanceSOL: 0,
    };
  }

  // ─────────────────────────────────────────────
  // Subclasses implement their decision logic here
  // ─────────────────────────────────────────────
  protected abstract decideAndAct(): Promise<AgentAction | null>;

  // ─────────────────────────────────────────────
  // Run loop
  // ─────────────────────────────────────────────
  start(intervalMs: number = 5000): void {
    if (this.state.status === "running") return;
    this.state.status = "running";
    this.log("Agent started");

    this.intervalHandle = setInterval(async () => {
      if (this.state.status !== "running") return;
      await this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.state.status = "stopped";
    this.log("Agent stopped");
  }

  pause(): void {
    this.state.status = "paused";
    this.log("Agent paused");
  }

  resume(): void {
    this.state.status = "running";
    this.log("Agent resumed");
  }

  private async tick(): Promise<void> {
    try {
      this.state.balanceSOL = await this.wallet.getBalance(this.connection);
      const action = await this.decideAndAct();
      if (action) {
        this.state.lastAction = action;
        this.state.actionHistory.push(action);
        // Keep history bounded
        if (this.state.actionHistory.length > 50) {
          this.state.actionHistory = this.state.actionHistory.slice(-50);
        }
      }
      this.state.cycleCount++;
    } catch (err: any) {
      this.state.status = "error";
      this.log(`Error in tick: ${err.message}`);
    }
  }

  getState(): AgentState {
    return { ...this.state };
  }

  protected log(msg: string): void {
    console.log(`[${this.state.agentId}] ${new Date().toISOString()} — ${msg}`);
  }

  protected recordAction(type: string, params: Record<string, any>, result?: TransactionResult): AgentAction {
    return {
      type,
      params,
      timestamp: new Date().toISOString(),
      result,
    };
  }
}
