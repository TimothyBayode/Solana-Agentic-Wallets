import {
  Keypair,
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import bs58 from "bs58";

export interface WalletConfig {
  agentId: string;
  storageDir?: string;
  encryptionKey?: string; // 32-byte hex key; if omitted, a random one is generated
}

export interface WalletInfo {
  agentId: string;
  publicKey: string;
  createdAt: string;
  network: string;
}

export interface TransactionResult {
  signature: string;
  success: boolean;
  error?: string;
}

const ALGORITHM = "aes-256-gcm";

export class AgentWallet {
  private keypair: Keypair;
  private agentId: string;
  private encryptionKey: Buffer;
  private storageDir: string;

  constructor(keypair: Keypair, config: WalletConfig, encryptionKey: Buffer) {
    this.keypair = keypair;
    this.agentId = config.agentId;
    this.encryptionKey = encryptionKey;
    this.storageDir = config.storageDir || path.join(process.cwd(), ".wallets");
  }

  // ─────────────────────────────────────────────
  // Factory: create a brand-new wallet
  // ─────────────────────────────────────────────
  static create(config: WalletConfig): AgentWallet {
    const keypair = Keypair.generate();
    const encKey = config.encryptionKey
      ? Buffer.from(config.encryptionKey, "hex")
      : crypto.randomBytes(32);

    const wallet = new AgentWallet(keypair, config, encKey);
    wallet.persist();
    return wallet;
  }

  // ─────────────────────────────────────────────
  // Factory: load an existing wallet from disk
  // ─────────────────────────────────────────────
  static load(agentId: string, encryptionKey: string, storageDir?: string): AgentWallet {
    const dir = storageDir || path.join(process.cwd(), ".wallets");
    const filePath = path.join(dir, `${agentId}.wallet`);

    if (!fs.existsSync(filePath)) {
      throw new Error(`No wallet found for agent: ${agentId}`);
    }

    const encKey = Buffer.from(encryptionKey, "hex");
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const secretKey = AgentWallet.decrypt(raw.encryptedKey, encKey);
    const keypair = Keypair.fromSecretKey(Buffer.from(secretKey, "hex"));

    return new AgentWallet(keypair, { agentId, storageDir }, encKey);
  }

  // ─────────────────────────────────────────────
  // Persist encrypted key to disk
  // ─────────────────────────────────────────────
  private persist(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }

    const encryptedKey = AgentWallet.encrypt(
      Buffer.from(this.keypair.secretKey).toString("hex"),
      this.encryptionKey
    );

    const data = {
      agentId: this.agentId,
      publicKey: this.publicKey,
      encryptedKey,
      createdAt: new Date().toISOString(),
      network: "devnet",
    };

    const filePath = path.join(this.storageDir, `${this.agentId}.wallet`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  // ─────────────────────────────────────────────
  // AES-256-GCM helpers
  // ─────────────────────────────────────────────
  private static encrypt(plaintext: string, key: Buffer): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
      data: encrypted.toString("hex"),
    });
  }

  private static decrypt(encryptedJson: string, key: Buffer): string {
    const { iv, tag, data } = JSON.parse(encryptedJson);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(tag, "hex"));
    return decipher.update(Buffer.from(data, "hex")) + decipher.final("utf8");
  }

  // ─────────────────────────────────────────────
  // Public accessors
  // ─────────────────────────────────────────────
  get publicKey(): string {
    return this.keypair.publicKey.toBase58();
  }

  get publicKeyObj(): PublicKey {
    return this.keypair.publicKey;
  }

  getEncryptionKeyHex(): string {
    return this.encryptionKey.toString("hex");
  }

  getInfo(): WalletInfo {
    return {
      agentId: this.agentId,
      publicKey: this.publicKey,
      createdAt: new Date().toISOString(),
      network: "devnet",
    };
  }

  // ─────────────────────────────────────────────
  // Balance
  // ─────────────────────────────────────────────
  async getBalance(connection: Connection): Promise<number> {
    const lamports = await connection.getBalance(this.keypair.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  // ─────────────────────────────────────────────
  // Airdrop (devnet only)
  // ─────────────────────────────────────────────
  async requestAirdrop(connection: Connection, sol: number = 1): Promise<string> {
    const sig = await connection.requestAirdrop(
      this.keypair.publicKey,
      sol * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  }

  // ─────────────────────────────────────────────
  // Transfer SOL autonomously (no human confirmation)
  // ─────────────────────────────────────────────
  async transferSOL(
    connection: Connection,
    toPublicKey: string,
    solAmount: number
  ): Promise<TransactionResult> {
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.keypair.publicKey,
          toPubkey: new PublicKey(toPublicKey),
          lamports: solAmount * LAMPORTS_PER_SOL,
        })
      );

      const signature = await sendAndConfirmTransaction(connection, tx, [this.keypair]);
      return { signature, success: true };
    } catch (err: any) {
      return { signature: "", success: false, error: err.message };
    }
  }

  // ─────────────────────────────────────────────
  // Sign arbitrary instructions (for protocol interactions)
  // ─────────────────────────────────────────────
  async signAndSendTransaction(
    connection: Connection,
    instructions: TransactionInstruction[]
  ): Promise<TransactionResult> {
    try {
      const tx = new Transaction().add(...instructions);
      const signature = await sendAndConfirmTransaction(connection, tx, [this.keypair]);
      return { signature, success: true };
    } catch (err: any) {
      return { signature: "", success: false, error: err.message };
    }
  }

  // Sign without broadcasting (for inspection / multi-sig flows)
  signTransaction(tx: Transaction): Transaction {
    tx.partialSign(this.keypair);
    return tx;
  }
}
