import { Connection } from "@solana/web3.js";
import { AgentWallet, WalletConfig, WalletInfo } from "./AgentWallet";
import * as fs from "fs";
import * as path from "path";

export interface AgentRecord {
  agentId: string;
  publicKey: string;
  encryptionKeyHex: string;
  createdAt: string;
}

export class WalletManager {
  private wallets: Map<string, AgentWallet> = new Map();
  private connection: Connection;
  private storageDir: string;
  private registryPath: string;

  constructor(connection: Connection, storageDir: string = ".wallets") {
    this.connection = connection;
    this.storageDir = storageDir;
    this.registryPath = path.join(storageDir, "registry.json");
    this.ensureStorageDir();
  }

  private ensureStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  // ─────────────────────────────────────────────
  // Create a new agent wallet
  // ─────────────────────────────────────────────
  async spawnAgent(agentId: string): Promise<AgentWallet> {
    if (this.wallets.has(agentId)) {
      throw new Error(`Agent ${agentId} already exists`);
    }

    const config: WalletConfig = { agentId, storageDir: this.storageDir };
    const wallet = AgentWallet.create(config);
    this.wallets.set(agentId, wallet);
    this.saveRegistry();

    console.log(`[WalletManager] Spawned agent: ${agentId} → ${wallet.publicKey}`);
    return wallet;
  }

  // ─────────────────────────────────────────────
  // Load from registry (e.g., after restart)
  // ─────────────────────────────────────────────
  loadFromRegistry(): void {
    if (!fs.existsSync(this.registryPath)) return;

    const registry: AgentRecord[] = JSON.parse(
      fs.readFileSync(this.registryPath, "utf-8")
    );

    for (const record of registry) {
      try {
        const wallet = AgentWallet.load(
          record.agentId,
          record.encryptionKeyHex,
          this.storageDir
        );
        this.wallets.set(record.agentId, wallet);
      } catch (e) {
        console.warn(`[WalletManager] Could not reload agent: ${record.agentId}`);
      }
    }

    console.log(`[WalletManager] Loaded ${this.wallets.size} agents from registry`);
  }

  // ─────────────────────────────────────────────
  // Persist registry (public keys + enc keys)
  // ─────────────────────────────────────────────
  private saveRegistry(): void {
    const records: AgentRecord[] = [];
    for (const [agentId, wallet] of this.wallets) {
      records.push({
        agentId,
        publicKey: wallet.publicKey,
        encryptionKeyHex: wallet.getEncryptionKeyHex(),
        createdAt: new Date().toISOString(),
      });
    }
    fs.writeFileSync(this.registryPath, JSON.stringify(records, null, 2), {
      mode: 0o600,
    });
  }

  getWallet(agentId: string): AgentWallet | undefined {
    return this.wallets.get(agentId);
  }

  listAgents(): WalletInfo[] {
    return Array.from(this.wallets.values()).map((w) => w.getInfo());
  }

  async getAllBalances(): Promise<Record<string, number>> {
    const balances: Record<string, number> = {};
    for (const [agentId, wallet] of this.wallets) {
      balances[agentId] = await wallet.getBalance(this.connection);
    }
    return balances;
  }

  get count(): number {
    return this.wallets.size;
  }
}
