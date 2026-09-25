/** Programmatic options for the official native server. */
export interface BotApiOptions {
  apiId: number | string;
  apiHash: string;
  port?: number;
  local?: boolean;
  dir?: string;
  tempDir?: string;
  host?: string;
  args?: readonly string[];
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
}
export interface BotApiServer {
  readonly pid: number;
  ready(): Promise<void>;
  stop(): Promise<void>;
}
export declare function startBotApiServer(options: BotApiOptions): BotApiServer;
