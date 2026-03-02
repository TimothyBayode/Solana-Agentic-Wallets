import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AgentWallet } from "../wallet/AgentWallet";

export interface SwapQuote {
  inputToken: "SOL" | "USDC";
  inputAmount: number;
  outputToken: "SOL" | "USDC";
  outputAmount: number;
  priceImpact: number;
  fee: number;
}

export interface PoolState {
  solReserve: number;
  usdcReserve: number;
  price: number; // SOL/USDC
  totalLiquidity: number;
  volume24h: number;
}

export class MockDeFiProtocol {
  private connection: Connection;
  private treasury: AgentWallet; // Protocol's own wallet (receives agent deposits)
  private poolState: PoolState;
  private swapHistory: SwapQuote[] = [];

  constructor(connection: Connection, treasuryWallet: AgentWallet) {
    this.connection = connection;
    this.treasury = treasuryWallet;
    // Simulated initial pool state
    this.poolState = {
      solReserve: 1000,
      usdcReserve: 150000,
      price: 150,
      totalLiquidity: 300000,
      volume24h: 0,
    };
  }

  // ─────────────────────────────────────────────
  // Simulate price feed with small random drift
  // ─────────────────────────────────────────────
  updatePrice(): void {
    const drift = (Math.random() - 0.48) * 2; // slight upward bias
    this.poolState.price = Math.max(50, this.poolState.price + drift);
    this.poolState.solReserve += (Math.random() - 0.5) * 10;
    this.poolState.usdcReserve = this.poolState.solReserve * this.poolState.price;
  }

  // ─────────────────────────────────────────────
  // Get a swap quote (no actual swap in simulation)
  // ─────────────────────────────────────────────
  getSwapQuote(inputToken: "SOL" | "USDC", inputAmount: number): SwapQuote {
    this.updatePrice();

    const priceImpact = (inputAmount / this.poolState.totalLiquidity) * 100;
    const fee = inputAmount * 0.003; // 0.3% fee

    const quote: SwapQuote = {
      inputToken,
      inputAmount,
      outputToken: inputToken === "SOL" ? "USDC" : "SOL",
      outputAmount:
        inputToken === "SOL"
          ? (inputAmount - fee) * this.poolState.price * (1 - priceImpact / 100)
          : (inputAmount - fee) / this.poolState.price * (1 - priceImpact / 100),
      priceImpact,
      fee,
    };

    this.swapHistory.push(quote);
    this.poolState.volume24h += inputAmount;
    return quote;
  }

  // ─────────────────────────────────────────────
  // Execute a "swap" — actually sends SOL to treasury on devnet
  // ─────────────────────────────────────────────
  async executeSwap(
    agentWallet: AgentWallet,
    inputToken: "SOL",
    inputAmount: number
  ): Promise<{ quote: SwapQuote; txSignature: string; success: boolean }> {
    const quote = this.getSwapQuote(inputToken, inputAmount);

    const result = await agentWallet.transferSOL(
      this.connection,
      this.treasury.publicKey,
      inputAmount
    );

    return {
      quote,
      txSignature: result.signature,
      success: result.success,
    };
  }

  // ─────────────────────────────────────────────
  // Add liquidity (deposit SOL to treasury)
  // ─────────────────────────────────────────────
  async addLiquidity(
    agentWallet: AgentWallet,
    solAmount: number
  ): Promise<{ success: boolean; lpTokens: number; txSignature: string }> {
    const result = await agentWallet.transferSOL(
      this.connection,
      this.treasury.publicKey,
      solAmount
    );

    const lpTokens = solAmount * (this.poolState.totalLiquidity / this.poolState.solReserve);
    if (result.success) {
      this.poolState.solReserve += solAmount;
      this.poolState.totalLiquidity += lpTokens;
    }

    return {
      success: result.success,
      lpTokens,
      txSignature: result.signature,
    };
  }

  getPoolState(): PoolState {
    return { ...this.poolState };
  }

  getTreasuryPublicKey(): string {
    return this.treasury.publicKey;
  }

  getSwapHistory(): SwapQuote[] {
    return [...this.swapHistory];
  }
}
