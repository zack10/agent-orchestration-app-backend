export interface McpResponse {
  status: 'success' | 'error';
  message: string;
  data?: any;
}

export interface McpConnector {
  type: string;
  execute(action: string, params: any, config: any): Promise<McpResponse>;
}
