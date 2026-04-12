import { McpConnector, McpResponse } from './types';
import axios from 'axios';

export class HttpConnector implements McpConnector {
  type = 'HTTP';

  async execute(action: string, params: any, config: any): Promise<McpResponse> {
    const { url, method = 'GET' } = config;
    
    try {
      console.log(`[HttpConnector] Executing ${method} on ${url}`);
      const response = await axios({
        method,
        url,
        data: params,
        params: method === 'GET' ? params : undefined,
      });

      return {
        status: 'success',
        message: `Successfully executed ${action}`,
        data: response.data,
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: `HTTP request failed: ${error.message}`,
        data: error.response?.data,
      };
    }
  }
}
