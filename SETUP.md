# Setup & Run Instructions

## Requirements

- **Node.js** v18 or higher → https://nodejs.org
- **npm** v9 or higher (comes with Node)
- Internet connection (for devnet activities only)

Check your versions:
```bash
node --version   # should be v18+
npm --version    # should be v9+
```

---

## Step 1 — Install Dependencies

Open a terminal, navigate to project root folder, and run:

```bash
npm install
```

This installs `@solana/web3.js`, TypeScript and all other dependencies.

---

## Step 2 — Quick Offline Demo (no internet needed)

This verifies everything works without touching the blockchain:

```bash
npx ts-node src/demo.ts
```

**Expected output:**
```
── 1. Wallet Creation ──────────────────────────────
Public Key: 7dHb...Xadp
Wallet file saved to .wallets/demo-agent-001.wallet

── 2. Wallet Reload from Disk ──────────────────────
Reloaded Public Key: 7dHb...Xadp
Keys match: 

── 3. Offline Transaction Signing ──────────────────
Transaction signed autonomously: 
Signatures: 1

── 4. Wallet Info ───────────────────────────────────
{ agentId: "demo-agent-001", publicKey: "...", network: "devnet" }

 Demo complete.
```

---

## Step 3 — Run Tests

```bash
npm test
```

**Expected output:**
```
▶ Wallet Creation
   PASS: Public key is 44 chars (base58)
   PASS: Encryption key is 32 bytes hex
   PASS: Two agents have different keypairs

▶ Wallet Persistence & Reload
   PASS: Reloaded wallet matches original
   PASS: Wrong encryption key throws on decrypt

▶ Offline Transaction Signing
   PASS: Transaction has at least one signature
   PASS: Signature is from correct key

▶ Wallet Info Structure
   PASS: getInfo() returns correct agentId
   PASS: getInfo() returns devnet
   PASS: getInfo() returns publicKey string

══════════════════════════════════════════
  Results: 10 passed, 0 failed
══════════════════════════════════════════
```

---

## Step 4 — Full Devnet Simulation (requires internet)

This runs 3 autonomous agents on Solana devnet for 60 seconds, making real transactions:

```bash
npm start
```

**What happens:**
1. Creates 4 wallets (3 agents + 1 protocol treasury)
2. Requests 0.1 SOL airdrop for each wallet from Solana devnet faucet or displays wallets that requires funding if rate limited
3. Starts all 3 agents autonomously
4. Agents trade/rebalance every ~8 seconds
5. Prints a summary every 15 seconds
6. Stops after 60 seconds and prints final report

**Expected output (abbreviated):**
```
═══════════════════════════════════════════════
   Solana Agent Wallet — Multi-Agent Demo
═══════════════════════════════════════════════

 Spawning agent wallets...
[WalletManager] Spawned agent: trader-alpha → 4xK2...
[WalletManager] Spawned agent: trader-beta  → 9mR7...
[WalletManager] Spawned agent: lp-gamma     → 2pQ1...

 Requesting devnet airdrops (this may take 10–20s)...
 Airdrops complete

 Initial Balances:
   trader-alpha: 0.1000 SOL
   trader-beta:  0.1000 SOL
   lp-gamma:     0.1000 SOL

 Starting autonomous agents...

[trader-alpha] 2026-03-02T09:00:01Z — Balance: 0.1000 SOL | Strategy: aggressive
[trader-alpha] 2026-03-02T09:00:01Z — Executing trade: sending 0.001 SOL
[trader-alpha] 2026-03-02T09:00:03Z — Trade executed ✓ sig: 3xK9mP2rQv...
```

**Verify transactions on-chain:**
Copy any signature from the output and paste it at:
https://explorer.solana.com/tx/YOUR_SIGNATURE?cluster=devnet

---

## Step 5 — Open the Dashboard

Open `dashboard/index.html` directly in your browser:

**Mac:**
```bash
open dashboard/index.html
```

**Windows:**
```bash
start dashboard/index.html
```

**Linux:**
```bash
xdg-open dashboard/index.html
```

The dashboard runs a live simulation in the browser — no server needed. You'll see:
- 3 agent cards with real-time balance bars
- Live SOL/USDC price chart
- Activity feed with every agent decision
- Transaction log with signatures and status

---

## File Structure

```
solana-agent-wallet/
│
├── src/
│   ├── wallet/
│   │   ├── AgentWallet.ts        ← Core: create, encrypt, sign, transfer
│   │   └── WalletManager.ts      ← Manages multiple agent wallets
│   │
│   ├── agent/
│   │   ├── BaseAgent.ts          ← Abstract agent with autonomous loop
│   │   ├── TradingAgent.ts       ← DeFi trading bot (3 strategies)
│   │   └── LiquidityAgent.ts     ← LP rebalancer
│   │
│   ├── protocols/
│   │   └── MockDeFiProtocol.ts   ← Sandboxed AMM (swap quotes, pool state)
│   │
│   ├── utils/
│   │   └── logger.ts             ← Structured JSONL logging
│   │
│   ├── index.ts                  ← Main: full devnet simulation
│   └── demo.ts                   ← Offline demo
│
├── tests/
│   └── test-suite.ts             ← Unit tests (offline)
│
├── dashboard/
│   └── index.html                ← Live monitoring dashboard
│
├── SKILLS.md                     ← Agent interface spec (required by bounty)
├── DEEP_DIVE.md                  ← Full architecture & security write-up
├── README.md                     ← Project overview
├── .env.example                  ← Environment variable template
├── package.json
└── tsconfig.json
```

---

## How Wallet Encryption Works

Every agent wallet is saved like this:

```
.wallets/
  trader-alpha.wallet    ← AES-256-GCM encrypted keypair (file permission: 0600)
  registry.json          ← Index of all agents + their encryption keys
```

The wallet file contains:
- `encryptedKey` — the secret key encrypted with AES-256-GCM
- `iv` — random 16-byte initialisation vector (new one every save)
- `tag` — GCM authentication tag (detects tampering)

**The encryption key is never stored in the wallet file.** In this prototype it's in `registry.json`. In production, move it to AWS KMS or HashiCorp Vault.

---

## Common Issues

**"Cannot find module '@solana/web3.js'"**
→ Run `npm install` first

**Airdrop fails / times out**
→ Solana devnet faucet is sometimes rate-limited. Wait 60 seconds and retry, or get SOL from https://faucet.solana.com

**"Error: blockhash not found"**
→ Network timeout. Re-run `npm start` — this is a devnet reliability issue, not a code bug.

**TypeScript errors**
→ Make sure you're on Node 18+: `node --version`

---

## Commands Summary

| Command | What it does |
|---------|-------------|
| `npm install` | Install all dependencies |
| `npx ts-node src/demo.ts` | Offline demo — wallet creation & signing |
| `npm test` | Run unit tests (offline) |
| `npm start` | Full devnet simulation (needs internet) |
| `open dashboard/index.html` | Open live monitoring dashboard |
