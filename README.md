# Solana Agent Wallet

> Autonomous AI agent wallets on Solana devnet. Each agent independently manages its own keypair, signs transactions, and interacts with a simulated DeFi protocol with no human confirmation required.

## What This Is

A working prototype demonstrating **agentic wallets** on Solana: wallets designed specifically for AI agents that can sign transactions, hold SOL and interact with protocols without human intervention.

**Includes:**
- `AgentWallet` — creates, encrypts, persists, and signs with a Solana keypair
- `WalletManager` — spawns and manages multiple agent wallets
- `TradingAgent` — autonomous trading bot (aggressive / conservative / random strategies)
- `LiquidityAgent` — autonomous LP rebalancer
- `MockDeFiProtocol` — sandboxed DeFi protocol with swap quotes and liquidity pools
- Live monitoring dashboard (HTML/JS)
- Full test suite

## Quick Start

```bash
# Install dependencies
npm install

# Run the offline demo (no devnet needed)
npx ts-node src/demo.ts

# Run tests
npm test

# Run full multi-agent devnet simulation (requires internet)
npm start

# Serve project files (required for dashboard live fetch)
npx serve .

# Open dashboard
# http://localhost:3000/dashboard/index.html
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Agent Layer                    │
│   TradingAgent       LiquidityAgent              │
│   (decides + acts)   (monitors + rebalances)     │
└────────────────────────┬────────────────────────┘
                         │ calls
┌────────────────────────▼────────────────────────┐
│               Wallet Layer                       │
│   AgentWallet — keypair, sign, transfer          │
│   WalletManager — registry of all agents         │
└────────────────────────┬────────────────────────┘
                         │ sends txs
┌────────────────────────▼────────────────────────┐
│             Protocol Layer                       │
│   MockDeFiProtocol — swap quotes, pool state     │
│   Solana Devnet — real on-chain settlement        │
└─────────────────────────────────────────────────┘
                         │ writes live state
┌────────────────────────▼────────────────────────┐
│             Monitoring Layer                     │
│   src/index.ts → .logs/dashboard-state.json      │
│   dashboard/index.html polls every 2s            │
└─────────────────────────────────────────────────┘
```

## Live Monitoring

The dashboard now supports real runtime data from `src/index.ts`:

- `src/index.ts` writes snapshots to `.logs/dashboard-state.json` every ~2 seconds
- `dashboard/index.html` polls `../.logs/dashboard-state.json` and renders:
- agent status, balances, cycle counts, latest action
- pool metrics (price, reserves, liquidity, volume)
- activity feed and transaction log
- if live JSON is unavailable, dashboard falls back to local simulation mode

Run flow:

1. `npm start` (produces `.logs/dashboard-state.json`)
2. `npx serve .`
3. Open `http://localhost:3000/dashboard/index.html`

## Security Design

| Concern | Approach |
|---------|----------|
| Key storage | AES-256-GCM encrypted, saved with mode 0600 |
| Key isolation | Each agent has a unique encryption key |
| In-memory signing | Keys are loaded into memory only when needed |
| No plaintext ever | Secret bytes never written to disk unencrypted |
| Production path | Replace file storage with AWS KMS / HashiCorp Vault |

**Encryption flow:**
```
generate keypair
  → serialize secret key to hex
  → AES-256-GCM encrypt with random 32-byte key
  → write ciphertext + IV + auth tag to .wallet file (mode 0600)
  → store encryption key securely (in prod: KMS / Vault)
```

## Wallet Operations

```typescript
// Create
const wallet = AgentWallet.create({ agentId: "trader-001" });

// Load
const wallet = AgentWallet.load("trader-001", encKeyHex);

// Autonomous transfer (no human confirmation)
const result = await wallet.transferSOL(connection, recipientAddr, 0.01);

// Arbitrary instruction signing
const result = await wallet.signAndSendTransaction(connection, [instruction]);

// Airdrop (devnet only)
await wallet.requestAirdrop(connection, 1);
```

## Agent Decision Loop

Agents extend `BaseAgent` and override `decideAndAct()`. The base class:
- Fetches wallet balance before each cycle
- Calls `decideAndAct()` on a configurable interval
- Records action history (bounded to last 50)
- Handles errors without crashing the loop

```typescript
class MyAgent extends BaseAgent {
  async decideAndAct(): Promise<AgentAction | null> {
    if (this.state.balanceSOL < 0.01) {
      return this.recordAction("SKIP", { reason: "low_balance" });
    }
    const result = await this.wallet.transferSOL(...);
    return this.recordAction("TRADE", { amount: 0.001 }, result);
  }
}

agent.start(5000);  // autonomous, every 5 seconds
agent.pause();
agent.resume();
agent.stop();
```

## Multi-Agent Scalability

The `WalletManager` registry pattern supports N agents independently:

```typescript
const manager = new WalletManager(connection);
const agents = await Promise.all(
  agentIds.map(id => manager.spawnAgent(id))
);
// Each agent: separate keypair, separate encryption key, separate wallet file
```

Agents are fully independent — no shared state, no shared keys.

## Project Structure

```
src/
  wallet/
    AgentWallet.ts       ← Core wallet: create, load, sign, transfer
    WalletManager.ts     ← Multi-agent registry
  agent/
    BaseAgent.ts         ← Abstract agent with decision loop
    TradingAgent.ts      ← DeFi trading bot
    LiquidityAgent.ts    ← LP rebalancer
  protocols/
    MockDeFiProtocol.ts  ← Sandboxed test DeFi protocol
  utils/
    logger.ts            ← Structured JSONL logging
  index.ts               ← Multi-agent devnet simulation
  demo.ts                ← Offline demo (no devnet needed)
tests/
  test-suite.ts          ← Unit tests
dashboard/
  index.html             ← Live monitoring dashboard
SKILLS.md                ← Agent interface documentation
```

## Extending This

- **Add a new agent type**: Extend `BaseAgent`, implement `decideAndAct()`
- **Add a real protocol**: Replace `MockDeFiProtocol` with Jupiter/Raydium SDK calls
- **Add SPL token support**: Use `@solana/spl-token` in `AgentWallet`
- **Add multi-sig**: Use `Transaction.partialSign()` with multiple wallets
- **Production keys**: Swap file storage for AWS KMS or HashiCorp Vault

## Resources

- [Solana Web3.js Docs](https://solana-labs.github.io/solana-web3.js/)
- [Solana RPC API](https://solana.com/docs/rpc)
- [Solana Devnet Faucet](https://faucet.solana.com)
- [SKILLS.md](./SKILLS.md) — Agent interface spec

## License

MIT
