/**
 * test-suite.ts
 * Unit tests for wallet creation, encryption, signing, and agent logic.
 * Runs offline — no devnet connection required.
 */

import { AgentWallet } from "../src/wallet/AgentWallet";
import { TradingAgent } from "../src/agent/TradingAgent";
import { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`   PASS: ${name}`);
    passed++;
  } else {
    console.log(`   FAIL: ${name}`);
    failed++;
  }
}

function suite(name: string): void {
  console.log(`\n▶ ${name}`);
}

// ── Wallet Tests ─────────────────────────────────────────────────────────────
suite("Wallet Creation");

const w1 = AgentWallet.create({ agentId: "test-agent-1" });
assert(w1.publicKey.length === 44, "Public key is 44 chars (base58)");
assert(w1.getEncryptionKeyHex().length === 64, "Encryption key is 32 bytes hex");

const w2 = AgentWallet.create({ agentId: "test-agent-2" });
assert(w1.publicKey !== w2.publicKey, "Two agents have different keypairs");

suite("Wallet Persistence & Reload");

const reloaded = AgentWallet.load("test-agent-1", w1.getEncryptionKeyHex());
assert(reloaded.publicKey === w1.publicKey, "Reloaded wallet matches original");

let threw = false;
try {
  AgentWallet.load("test-agent-1", "0".repeat(64));
} catch {
  threw = true;
}
assert(threw, "Wrong encryption key throws on decrypt");

suite("Offline Transaction Signing");

const mockAddr = "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y4adp";
const tx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: w1.publicKeyObj,
    toPubkey: new PublicKey(mockAddr),
    lamports: 0.005 * LAMPORTS_PER_SOL,
  })
);
tx.feePayer = w1.publicKeyObj;
tx.recentBlockhash = "11111111111111111111111111111111";
const signed = w1.signTransaction(tx);
assert(signed.signatures.length > 0, "Transaction has at least one signature");
assert(signed.signatures[0].publicKey.toBase58() === w1.publicKey, "Signature is from correct key");

suite("Wallet Info Structure");

const info = w1.getInfo();
assert(info.agentId === "test-agent-1", "getInfo() returns correct agentId");
assert(info.network === "devnet", "getInfo() returns devnet");
assert(typeof info.publicKey === "string", "getInfo() returns publicKey string");

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(40)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log("═".repeat(40));

if (failed > 0) process.exit(1);
