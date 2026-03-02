import { Connection, clusterApiUrl } from "@solana/web3.js";
import { WalletManager } from "./wallet/WalletManager";
import { TradingAgent } from "./agent/TradingAgent";
import { LiquidityAgent } from "./agent/LiquidityAgent";
import { MockDeFiProtocol } from "./protocols/MockDeFiProtocol";
import { AgentLogger } from "./utils/logger";
import * as fs from "fs";
import * as path from "path";

const DEVNET_URL = clusterApiUrl("devnet");
const RUN_DURATION_MS = 60_000;
const CYCLE_INTERVAL_MS = 8_000;
const AIRDROP_DELAY_MS = 12_000;
const MIN_REQUIRED_BALANCE_SOL = 0.02;
const TREASURY_TARGET_BALANCE_SOL = 0.2;
const TREASURY_BUFFER_SOL = 0.03;
const DASHBOARD_STATE_PATH = path.join(".logs", "dashboard-state.json");
const DASHBOARD_PUSH_INTERVAL_MS = 2_000;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log("   Solana Agent Wallet — Multi-Agent Demo");
  console.log("═══════════════════════════════════════════════\n");

  const connection = new Connection(DEVNET_URL, "confirmed");
  const logger = new AgentLogger();
  const manager = new WalletManager(connection);

  manager.loadFromRegistry();

  // ── Spawn wallets ────────────────────────────────────────
  console.log(" Loading/spawning agent wallets...\n");

  const getOrSpawnWallet = async (agentId: string) => {
    const existing = manager.getWallet(agentId);
    if (existing) {
      console.log(`[WalletManager] Reusing agent: ${agentId} → ${existing.publicKey}`);
      return existing;
    }
    return manager.spawnAgent(agentId);
  };

  const tradingWallet1 = await getOrSpawnWallet("trader-alpha");
  const tradingWallet2 = await getOrSpawnWallet("trader-beta");
  const liquidityWallet = await getOrSpawnWallet("lp-gamma");
  const protocolWallet = await getOrSpawnWallet("protocol-treasury");

  console.log("\n Funding wallets (single faucet request + treasury distribution)...\n");

  const traderTargets = [
    { id: "trader-alpha", wallet: tradingWallet1 },
    { id: "trader-beta", wallet: tradingWallet2 },
    { id: "lp-gamma", wallet: liquidityWallet },
  ];

  const currentBalances = await manager.getAllBalances();
  let totalNeededForAgents = 0;
  for (const { id } of traderTargets) {
    const current = currentBalances[id] ?? 0;
    totalNeededForAgents += Math.max(MIN_REQUIRED_BALANCE_SOL - current, 0);
  }

  const currentTreasuryBalance = currentBalances["protocol-treasury"] ?? 0;
  const desiredTreasuryBalance = Math.max(
    TREASURY_TARGET_BALANCE_SOL,
    totalNeededForAgents + TREASURY_BUFFER_SOL
  );
  const treasuryTopUpNeeded = Math.max(desiredTreasuryBalance - currentTreasuryBalance, 0);

  if (treasuryTopUpNeeded > 0) {
    try {
      await protocolWallet.requestAirdrop(connection, Math.max(treasuryTopUpNeeded, 0.01));
      console.log(
        ` Treasury airdrop complete (+${Math.max(treasuryTopUpNeeded, 0.01).toFixed(4)} SOL)`
      );
      await sleep(AIRDROP_DELAY_MS);
    } catch (err: any) {
      console.warn(` Treasury airdrop failed: ${err?.message ?? String(err)}`);
    }
  } else {
    console.log(
      ` Treasury already funded (${currentTreasuryBalance.toFixed(4)} SOL), skipping faucet request`
    );
  }

  for (const { id, wallet } of traderTargets) {
    const balance = await wallet.getBalance(connection);
    const topUpNeeded = Math.max(MIN_REQUIRED_BALANCE_SOL - balance, 0);
    if (topUpNeeded <= 0) {
      console.log(` ${id} already funded (${balance.toFixed(4)} SOL)`);
      continue;
    }

    const transferResult = await protocolWallet.transferSOL(
      connection,
      wallet.publicKey,
      topUpNeeded
    );

    if (transferResult.success) {
      console.log(` Funded ${id} from treasury (+${topUpNeeded.toFixed(4)} SOL)`);
    } else {
      console.warn(
        ` Could not fund ${id} from treasury: ${transferResult.error ?? "unknown error"}`
      );
    }
  }

  const postFundingBalances = await manager.getAllBalances();
  const fundedCount = Object.values(postFundingBalances).filter(
    (bal) => bal >= MIN_REQUIRED_BALANCE_SOL
  ).length;

  if (fundedCount === 0) {
    console.error(" No wallet could be funded.");
    console.error("Manual funding needed (devnet):");
    console.error(`  trader-alpha: ${tradingWallet1.publicKey}`);
    console.error(`  trader-beta: ${tradingWallet2.publicKey}`);
    console.error(`  lp-gamma: ${liquidityWallet.publicKey}`);
    console.error(`  protocol-treasury: ${protocolWallet.publicKey}`);
    throw new Error(
      "Faucet unavailable and no funded wallets detected. Fund any wallet manually, then rerun."
    );
  }

  console.log(` Funding step complete (${fundedCount}/4 wallets at or above ${MIN_REQUIRED_BALANCE_SOL} SOL)\n`);

  // Print initial balances
  const balances = await manager.getAllBalances();
  console.log(" Initial Balances:");
  for (const [id, bal] of Object.entries(balances)) {
    console.log(`   ${id}: ${bal.toFixed(4)} SOL`);
  }
  console.log();

  // ── Set up mock protocol ─────────────────────────────────
  const protocol = new MockDeFiProtocol(connection, protocolWallet);

  // ── Instantiate agents ───────────────────────────────────
  const agent1 = new TradingAgent(tradingWallet1, connection, {
    marketAddress: protocol.getTreasuryPublicKey(),
    tradeThresholdSOL: 0.01,
    tradeAmountSOL: 0.001,
    strategy: "aggressive",
  });

  const agent2 = new TradingAgent(tradingWallet2, connection, {
    marketAddress: protocol.getTreasuryPublicKey(),
    tradeThresholdSOL: 0.01,
    tradeAmountSOL: 0.001,
    strategy: "conservative",
  });

  const agent3 = new LiquidityAgent(liquidityWallet, connection, {
    poolAddress: protocol.getTreasuryPublicKey(),
    targetRatio: 0.5,
    rebalanceThreshold: 0.1,
    depositAmountSOL: 0.001,
  });

  // ── Start all agents ─────────────────────────────────────
  console.log(" Starting autonomous agents...\n");
  agent1.start(CYCLE_INTERVAL_MS);
  agent2.start(CYCLE_INTERVAL_MS + 1000); // stagger slightly
  agent3.start(CYCLE_INTERVAL_MS + 2000);

  const activityFeed: Array<{
    timestamp: string;
    agentId: string;
    type: string;
    message: string;
  }> = [];
  const txFeed: Array<{
    timestamp: string;
    agentId: string;
    action: string;
    amount: number;
    signature: string;
    success: boolean;
  }> = [];
  const processedActions: Record<string, number> = {
    "trader-alpha": 0,
    "trader-beta": 0,
    "lp-gamma": 0,
  };

  const actionMessage = (type: string, params: Record<string, any>): string => {
    switch (type) {
      case "TRADE":
        return `Sent ${(params.amount ?? 0).toFixed(4)} SOL to protocol`;
      case "REBALANCE":
        return `Deposited ${(params.depositAmount ?? 0).toFixed(4)} SOL to pool`;
      case "SKIP":
        return `Skipped action (${params.reason ?? "unknown reason"})`;
      case "HOLD":
        return "Strategy decided to hold";
      case "OBSERVE":
        return `Observed pool ratio ${Number(params.poolRatio ?? 0).toFixed(3)}`;
      default:
        return type;
    }
  };

  const pushDashboardState = () => {
    const states = [agent1.getState(), agent2.getState(), agent3.getState()];

    for (const state of states) {
      const alreadyProcessed = processedActions[state.agentId] ?? 0;
      const newActions = state.actionHistory.slice(alreadyProcessed);
      if (newActions.length === 0) continue;

      for (const action of newActions) {
        activityFeed.push({
          timestamp: action.timestamp,
          agentId: state.agentId,
          type: action.type,
          message: actionMessage(action.type, action.params || {}),
        });

        if (action.result?.signature) {
          const rawAmount = action.params?.amount ?? action.params?.depositAmount ?? 0;
          txFeed.push({
            timestamp: action.timestamp,
            agentId: state.agentId,
            action: action.type,
            amount: Number(rawAmount) || 0,
            signature: action.result.signature,
            success: !!action.result.success,
          });
        }
      }

      processedActions[state.agentId] = state.actionHistory.length;
    }

    const recentActivities = activityFeed.slice(-30);
    const recentTxs = txFeed.slice(-20);
    const totalVolume = txFeed.reduce((sum, tx) => sum + tx.amount, 0);
    const poolState = protocol.getPoolState();

    const payload = {
      updatedAt: new Date().toISOString(),
      source: "src/index.ts",
      stats: {
        activeAgents: states.filter((s) => s.status === "running").length,
        totalTxs: txFeed.length,
        totalVolume,
      },
      pool: {
        price: poolState.price,
        solReserve: poolState.solReserve,
        usdcReserve: poolState.usdcReserve,
        volume24h: poolState.volume24h,
        totalLiquidity: poolState.totalLiquidity,
      },
      agents: states.map((s) => ({
        id: s.agentId,
        strategy:
          s.agentId === "trader-alpha"
            ? "aggressive"
            : s.agentId === "trader-beta"
              ? "conservative"
              : "liquidity",
        status: s.status,
        pubkey: s.publicKey,
        balance: s.balanceSOL,
        maxBalance: 0.1,
        cycles: s.cycleCount,
        transactions: txFeed.filter((tx) => tx.agentId === s.agentId).length,
        lastAction: s.lastAction?.type || "—",
      })),
      activities: recentActivities,
      transactions: recentTxs,
    };

    fs.writeFileSync(DASHBOARD_STATE_PATH, JSON.stringify(payload, null, 2));
  };

  pushDashboardState();
  const dashboardInterval = setInterval(() => {
    protocol.updatePrice();
    pushDashboardState();
  }, DASHBOARD_PUSH_INTERVAL_MS);

  // ── Periodic summary ─────────────────────────────────────
  const summaryInterval = setInterval(async () => {
    console.log("\n─────── Agent Summary ───────");
    const states = [agent1.getState(), agent2.getState(), agent3.getState()];
    for (const s of states) {
      console.log(
        `  ${s.agentId.padEnd(16)} | ${s.status.padEnd(8)} | ` +
        `cycles: ${s.cycleCount} | bal: ${s.balanceSOL.toFixed(4)} SOL | ` +
        `last: ${s.lastAction?.type || "—"}`
      );
    }
    console.log(`  Pool SOL price: $${protocol.getPoolState().price.toFixed(2)}`);
    console.log("─────────────────────────────\n");
  }, 15_000);

  // ── Run for duration then stop ───────────────────────────
  await sleep(RUN_DURATION_MS);
  clearInterval(summaryInterval);
  clearInterval(dashboardInterval);

  agent1.stop();
  agent2.stop();
  agent3.stop();

  console.log("\n═══════════════════════════════════════════════");
  console.log("   Simulation Complete — Final Report");
  console.log("═══════════════════════════════════════════════\n");

  const finalBalances = await manager.getAllBalances();
  for (const [id, bal] of Object.entries(finalBalances)) {
    console.log(`${id}: ${bal.toFixed(6)} SOL`);
  }

  const states = [agent1.getState(), agent2.getState(), agent3.getState()];
  for (const s of states) {
    console.log(`\n[${s.agentId}] completed ${s.cycleCount} cycles`);
    console.log(`  Last ${Math.min(3, s.actionHistory.length)} actions:`);
    s.actionHistory.slice(-3).forEach((a) => {
      console.log(`    ${a.timestamp} → ${a.type}${a.result?.signature ? ` (sig: ${a.result.signature.slice(0,12)}...)` : ""}`);
    });
  }

  pushDashboardState();

  console.log("\n All agents stopped. Logs written to .logs/");
}

main().catch(console.error);
