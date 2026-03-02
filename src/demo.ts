import { AgentWallet } from "./wallet/AgentWallet";
import { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

function hr(label: string): void {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`  ${label}`);
  console.log("─".repeat(50));
}

async function main() {
  hr("1. Wallet Creation");
  const wallet = AgentWallet.create({ agentId: "demo-agent-001" });
  console.log("Public Key:", wallet.publicKey);
  console.log("Wallet file saved to .wallets/demo-agent-001.wallet (AES-256-GCM encrypted)");

  hr("2. Wallet Reload from Disk");
  const reloaded = AgentWallet.load(
    "demo-agent-001",
    wallet.getEncryptionKeyHex()
  );
  console.log("Reloaded Public Key:", reloaded.publicKey);
  console.log("Keys match:", wallet.publicKey === reloaded.publicKey ? "" : "");

  hr("3. Offline Transaction Signing");
  const mockRecipient = "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y4adp";
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKeyObj,
      toPubkey: new PublicKey(mockRecipient),
      lamports: 0.01 * LAMPORTS_PER_SOL,
    })
  );
  tx.feePayer = wallet.publicKeyObj;
  tx.recentBlockhash = "11111111111111111111111111111111"; // placeholder
  const signed = wallet.signTransaction(tx);
  console.log("Transaction signed autonomously: ");
  console.log("Signatures:", signed.signatures.length);

  hr("4. Wallet Info");
  console.log(JSON.stringify(wallet.getInfo(), null, 2));

  console.log("\n Demo complete. To run the full devnet simulation: npx ts-node src/index.ts");
}

main().catch(console.error);
