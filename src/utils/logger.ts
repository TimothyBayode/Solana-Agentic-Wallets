import * as fs from "fs";
import * as path from "path";

export interface LogEntry {
  timestamp: string;
  agentId: string;
  level: "INFO" | "WARN" | "ERROR" | "ACTION";
  message: string;
  data?: Record<string, any>;
}

export class AgentLogger {
  private logFile: string;
  private entries: LogEntry[] = [];

  constructor(logDir: string = ".logs") {
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    this.logFile = path.join(logDir, `agent-log-${Date.now()}.jsonl`);
  }

  log(agentId: string, level: LogEntry["level"], message: string, data?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      agentId,
      level,
      message,
      data,
    };
    this.entries.push(entry);
    fs.appendFileSync(this.logFile, JSON.stringify(entry) + "\n");

    const prefix = { INFO: "ℹ", WARN: "⚠", ERROR: "✗", ACTION: "⚡" }[level];
    console.log(`${prefix} [${agentId}] ${message}`, data ? JSON.stringify(data) : "");
  }

  getEntries(agentId?: string): LogEntry[] {
    return agentId ? this.entries.filter((e) => e.agentId === agentId) : this.entries;
  }

  exportJSON(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}
