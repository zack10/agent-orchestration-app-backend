export interface McpResponse {
  status: "success" | "error";
  message: string;
  data?: unknown;
}

export type ConnectorParams = Record<string, unknown>;
export type ConnectorConfig = Record<string, unknown>;

export interface McpConnector {
  type: string;
  execute(
    action: string,
    params: ConnectorParams,
    config: ConnectorConfig,
  ): Promise<McpResponse>;
}
