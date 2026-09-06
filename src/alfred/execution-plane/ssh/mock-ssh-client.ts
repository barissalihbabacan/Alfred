/**
 * B.U.T.L.E.R. Alfred — Mock SSH Client
 * Test double for ISSHClient to support reliable and deterministic unit tests.
 */

import { ISSHClient } from "./ssh-client.interface.js";
import { SSHHostConfig } from "../../../core/config/ssh.config.js";

export type MockSSHBehavior = "success" | "auth_failure" | "timeout" | "connection_refused" | "unreachable";

export class MockSSHClient implements ISSHClient {
  private connected = false;
  public connectCalls: SSHHostConfig[] = [];
  public disconnectCalls = 0;
  public behavior: MockSSHBehavior = "success";
  public simulatedDelayMs = 0;

  constructor(behavior: MockSSHBehavior = "success", simulatedDelayMs = 0) {
    this.behavior = behavior;
    this.simulatedDelayMs = simulatedDelayMs;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async connect(config: SSHHostConfig): Promise<void> {
    this.connectCalls.push(config);

    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedDelayMs));
    }

    switch (this.behavior) {
      case "success":
        this.connected = true;
        return;
      case "auth_failure":
        this.connected = false;
        throw new Error("SSH connection failed: Authentication failed (public key rejected or unauthorized).");
      case "timeout":
        this.connected = false;
        throw new Error(`SSH connection timed out after ${config.connectionTimeoutMs}ms.`);
      case "connection_refused":
        this.connected = false;
        throw new Error("SSH connection failed: Connection refused by target host.");
      case "unreachable":
        this.connected = false;
        throw new Error("SSH connection failed: Host unreachable or network unavailable.");
      default:
        this.connected = true;
        return;
    }
  }

  public async disconnect(): Promise<void> {
    this.disconnectCalls++;
    this.connected = false;
  }
}
