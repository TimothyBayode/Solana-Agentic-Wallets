# Deep Dive: Agentic Wallets on Solana
## Architecture, Security, and AI Agent Integration

---

## 1. What Is an Agentic Wallet?

A standard crypto wallet is designed for humans: you approve each transaction, control the keys, and decide when to sign. An **agentic wallet** inverts this model. The wallet is controlled by software — an AI agent — that autonomously decides when to transact, signs without human confirmation, and operates continuously in a loop.

This creates a fundamentally different security and design challenge. The question shifts from "how do I keep my keys safe from attackers?" to "how do I keep my keys safe *and* give my own code access to them programmatically?"

---

## 2. Wallet Architecture

### 2.1 Keypair Generation

Solana wallets are Ed25519 keypairs. The `@solana/web3.js` library generates them via `Keypair.generate()`, which uses the Node.js `crypto.randomBytes()` function under the hood — a CSPRNG backed by the OS entropy pool.

```
OS entropy (urandom) → CSPRNG → 32-byte seed → Ed25519 keypair
```

The public key (32 bytes, base58-encoded to 44 chars) becomes the wallet address. The secret key (64 bytes: seed + public key) is what we need to protect.

### 2.2 Encrypted Key Storage

We use **AES-256-GCM** — authenticated encryption — to store the secret key:

```
secretKey (hex) 
  → AES-256-GCM encrypt (random 32-byte key, random 16-byte IV)
  → ciphertext + IV + GCM auth tag
  → written to .wallets/{agentId}.wallet (mode 0600)
```

Why AES-256-GCM?
- **256-bit key**: computationally infeasible to brute force
- **GCM mode**: authenticated encryption — detects any tampering with the ciphertext
- **Random IV per write**: same key encrypts differently each time
- **Auth tag**: if any byte of the ciphertext changes, decryption fails loudly

The encryption key itself must be stored separately from the wallet file. In this prototype it's in a registry file; in production it should live in AWS KMS, HashiCorp Vault, or an HSM.

### 2.3 Key Isolation Between Agents

Each agent gets its own encryption key. This means compromising one agent's key does not expose any other agent's private key. The `WalletManager` registry stores each agent's encryption key reference separately:

```
.wallets/
  registry.json              ← { agentId, publicKey, encryptionKeyHex }[]
  trader-alpha.wallet        ← AES-encrypted keypair
  trader-beta.wallet         ← different key, different ciphertext
  lp-gamma.wallet
```

---

## 3. The Decision Loop

The core of an autonomous agent is its decision loop. `BaseAgent` provides a configurable interval timer that calls `decideAndAct()` on each tick:

```
start(intervalMs)
  → setInterval(tick, intervalMs)
    → refresh balance
    → call decideAndAct()   ← subclass implements this
    → record action
    → increment cycleCount
```

The separation is critical: **the wallet knows nothing about strategy; the agent knows nothing about cryptography.** Clean boundaries:

| Layer | Responsibilities |
|-------|-----------------|
| `AgentWallet` | Keypair, signing, broadcasting, balance |
| `BaseAgent` | Loop, state, history, lifecycle |
| `TradingAgent` | When to trade, how much |
| `MockDeFiProtocol` | Price feeds, swap quotes, pool state |

### 3.1 TradingAgent Strategy

The `TradingAgent` implements three strategies:

- **Aggressive**: trades on every cycle where balance allows (75% action rate)
- **Conservative**: trades every 3rd cycle (33% rate)
- **Random**: 40% chance per cycle

All strategies share the same signing and broadcast path — only the decision logic differs.

### 3.2 LiquidityAgent

The `LiquidityAgent` monitors a simulated pool ratio and rebalances when the deviation exceeds a threshold. It simulates fee accrual proportional to its deposited balance. This mimics a real LP position where fees accumulate continuously.

---

## 4. Protocol Interaction

`MockDeFiProtocol` simulates a constant-product AMM (like Uniswap v2 / Raydium) with:

- **Price oracle**: random walk with slight drift
- **Swap quotes**: applies price impact and 0.3% fee
- **Liquidity**: tracks reserves and LP token issuance
- **Real devnet settlement**: swap "execution" sends actual SOL to the protocol treasury on devnet

The formula for swap output:
```
outputAmount = (inputAmount - fee) * price * (1 - priceImpact/100)
priceImpact = (inputAmount / totalLiquidity) * 100
```

For production: replace `MockDeFiProtocol` with Jupiter SDK (aggregated liquidity), Raydium SDK (AMM pools), or Orca (concentrated liquidity).

---

## 5. Security Considerations

### 5.1 Threat Model

| Threat | Mitigation |
|--------|-----------|
| File system compromise | Keys encrypted at rest (AES-256-GCM) |
| Memory scraping | Keys in memory only during active signing |
| Replay attacks | Solana uses recent blockhashes (expire in ~2 min) |
| Transaction substitution | Instructions are constructed by the agent, not accepted externally |
| Runaway agent | Balance threshold checks before every transaction |
| Key sharing between agents | Each agent has a unique encryption key |

### 5.2 What This Prototype Does NOT Handle (Production Checklist)

1. **Key management service**: Replace file-based enc keys with AWS KMS / GCP KMS / HashiCorp Vault. Never store encryption keys in plaintext anywhere.

2. **Rate limiting**: Add per-agent transaction rate limits to prevent runaway spending from a buggy decision loop.

3. **Spending caps**: Hard cap on SOL per transaction and per time window at the wallet layer — not just at the agent layer.

4. **Multi-sig approval**: For large transactions, require m-of-n signature from a governance wallet.

5. **TEE execution**: For maximum security, run agent processes in a Trusted Execution Environment (Intel SGX, AWS Nitro Enclaves) so keys are never accessible even to the host OS.

6. **Audit logs**: Every transaction attempt (success or failure) should be written to an immutable append-only log.

7. **Simulation before execution**: Before broadcasting, simulate the transaction with `connection.simulateTransaction()` to catch errors before spending fees.

### 5.3 The Custodial Spectrum

```
←─ less trust required             more trust required ─→

User-controlled    Agentic (this)    Fully custodial
(Phantom/Solflare) (autonomous)     (exchange wallet)
```

Agentic wallets sit in the middle. The user trusts the agent code with their keys, but retains ownership of the wallet (vs. a custodial exchange where the exchange controls the keys). This makes agent code quality and key management the critical security surface.

---

## 6. Multi-Agent Scalability

The `WalletManager` + `BaseAgent` pattern scales horizontally:

- **N agents, N isolated keypairs**: no shared state
- **Parallel operation**: each agent runs its own setInterval loop
- **Independent decision logic**: different agent types can coexist
- **Registry persistence**: agents survive process restarts

To scale to 100+ agents:
1. Move from file storage to a database (PostgreSQL + encrypted key column)
2. Use a worker thread pool instead of setInterval per agent
3. Batch RPC calls with `connection.getMultipleAccountsInfo()` for balance queries
4. Use a message queue (Redis/SQS) for agent action coordination

---

## 6.5 Live Agent Monitoring

The prototype includes a live monitoring path between backend and dashboard:

```
src/index.ts
  → collects agent states, recent actions, tx results, pool state
  → writes .logs/dashboard-state.json every ~2s
dashboard/index.html
  → polls ../.logs/dashboard-state.json
  → renders live cards, feed, tx log, and pool metrics
```

Payload categories:
- `stats`: active agents, total txs, total volume
- `agents`: id, status, pubkey, balance, cycles, transactions, last action
- `pool`: price, reserves, liquidity, volume24h
- `activities`: recent action feed entries
- `transactions`: recent confirmed/failed transactions

Operational note: the dashboard should be opened through an HTTP server (`npx serve .`) so browser fetch works. Opening via `file://` can block live polling.

---

## 7. Interaction with AI Models

This prototype uses **scripted decision logic** (rule-based agents). The natural extension is to wire an LLM into `decideAndAct()`:

```typescript
protected async decideAndAct(): Promise<AgentAction | null> {
  const context = {
    balance: this.state.balanceSOL,
    cycleCount: this.state.cycleCount,
    recentHistory: this.state.actionHistory.slice(-5),
    poolPrice: await this.protocol.getPoolState(),
  };

  // Ask the LLM what to do
  const decision = await llm.complete({
    system: "You are a conservative DeFi trading agent...",
    prompt: JSON.stringify(context),
  });

  // Parse structured response and execute
  const action = JSON.parse(decision);
  if (action.type === "TRADE") {
    const result = await this.wallet.transferSOL(...);
    return this.recordAction("TRADE", action.params, result);
  }
}
```

The wallet layer remains unchanged — LLM integration is purely in the decision layer.

---

## 8. Devnet Demo Flow

Running `npm start` executes this sequence:

1. `WalletManager` creates 4 wallets (3 agents + 1 protocol treasury)
2. Funding stage: treasury-first airdrop/top-up, then treasury distributes SOL to agent wallets
3. `TradingAgent` (alpha, aggressive) starts → trades every ~8s
4. `TradingAgent` (beta, conservative) starts → trades every ~24s
5. `LiquidityAgent` (gamma) starts → monitors pool ratio, rebalances on deviation
6. Runtime snapshots are written to `.logs/dashboard-state.json` for dashboard live monitoring
7. All transactions land on Solana devnet — verifiable on [Solana Explorer](https://explorer.solana.com/?cluster=devnet)
8. After 60s, all agents stop and print a final report

---

## 9. Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                    AGENT LAYER                           │
│  ┌─────────────────┐  ┌─────────────────┐               │
│  │  TradingAgent   │  │  LiquidityAgent │               │
│  │  (aggressive/   │  │  (rebalancer)   │               │
│  │   conservative) │  │                 │               │
│  └────────┬────────┘  └────────┬────────┘               │
└───────────┼─────────────────────┼──────────────────────--┘
            │ wallet.transferSOL()│ wallet.transferSOL()
┌───────────▼─────────────────────▼────────────────────────┐
│                    WALLET LAYER                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ AgentWallet  │  │ AgentWallet  │  │  AgentWallet  │  │
│  │ trader-alpha │  │ trader-beta  │  │   lp-gamma    │  │
│  │ AES-256-GCM  │  │ AES-256-GCM  │  │  AES-256-GCM  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
└─────────┼────────────────-┼───────────────────┼──────────┘
          │   signed txs    │                   │
┌─────────▼─────────────────▼───────────────────▼──────────┐
│              SOLANA DEVNET (real blockchain)              │
│                                                          │
│     MockDeFiProtocol.treasury ← receives all deposits    │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│               LIVE MONITORING PIPELINE                  │
│ .logs/dashboard-state.json ← src/index.ts (2s writes)   │
│ dashboard/index.html      ← polls + renders live state   │
└──────────────────────────────────────────────────────────┘
```

---

## 10. Next Steps

- Replace `MockDeFiProtocol` with **Jupiter SDK** for real aggregated swaps
- Add **SPL token support** (USDC, BONK, etc.) via `@solana/spl-token`
- Integrate **LLM decision layer** (GPT-4, Claude) into `decideAndAct()`
- Deploy encryption keys to **AWS KMS** for production key management
- Add **simulation pre-flight** before every transaction
- Build a **governance wallet** for multi-sig approval of large transactions
