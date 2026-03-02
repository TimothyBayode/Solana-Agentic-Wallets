# Agent Interface Specification

This file documents how AI agents can discover, instantiate, and operate wallets in this system.

## Wallet Creation

```typescript
import { AgentWallet } from "./src/wallet/AgentWallet";

// Create a new wallet for an agent - Generates keypair, encrypts with AES-256-GCM, saves to .wallets
const wallet = AgentWallet.create({ agentId: "my-agent-001" });

// Reload an existing wallet
const wallet = AgentWallet.load("my-agent-001", encryptionKeyHex);
```

## Core Capabilities

| Method | Description |
|--------|-------------|
| `wallet.publicKey` | Agent's public key (base58) |
| `wallet.getBalance(connection)` | SOL balance in floating point |
| `wallet.requestAirdrop(connection, sol)` | Devnet only — funds the wallet |
| `wallet.transferSOL(connection, toAddr, amount)` | Autonomous SOL transfer |
| `wallet.signAndSendTransaction(connection, instructions)` | Execute arbitrary instructions |
| `wallet.signTransaction(tx)` | Sign without broadcasting |

## Spawning Multiple Agents

```typescript
import { WalletManager } from "./src/wallet/WalletManager";

const manager = new WalletManager(connection);
const agentWallet = await manager.spawnAgent("agent-42");
// Each agent gets its own isolated keypair and encrypted storage
```

## Building an Agent

Extend `BaseAgent` and implement `decideAndAct()`:

```typescript
class MyAgent extends BaseAgent {
  protected async decideAndAct(): Promise<AgentAction | null> {
    const balance = this.state.balanceSOL;
    if (balance < 0.01) return this.recordAction("SKIP", { reason: "low_balance" });

    const result = await this.wallet.transferSOL(this.connection, TARGET, 0.001);
    return this.recordAction("TRADE", { amount: 0.001 }, result);
  }
}

const agent = new MyAgent(wallet, connection);
agent.start(5000); // runs every 5 seconds autonomously
```

## Security Model

- Private keys are **never stored in plaintext**
- Each agent uses a **unique AES-256-GCM key**
- Key files are created with **mode 0600** (owner read-only)
- Agents sign transactions **in-memory only** keys do not leave the process
- For production: store encryption keys in a secrets manager (AWS KMS, Vault, etc.)

## Protocol Interaction

```typescript
import { MockDeFiProtocol } from "./src/protocols/MockDeFiProtocol";

const protocol = new MockDeFiProtocol(connection, treasuryWallet);
const quote = protocol.getSwapQuote("SOL", 0.01);
const result = await protocol.executeSwap(agentWallet, "SOL", 0.01);
```

## Network

- **Network**: Solana Devnet (`https://api.devnet.solana.com`)
- **Airdrop**: Up to 1 SOL per request on devnet
- **RPC**: Standard Solana JSON RPC v1

## File Structure

```
.wallets/
  registry.json        ← agent index (public keys + enc key refs)
  {agentId}.wallet     ← encrypted keypair (AES-256-GCM, mode 0600)
.logs/
  agent-log-*.jsonl    ← structured action logs (JSONL)
```
