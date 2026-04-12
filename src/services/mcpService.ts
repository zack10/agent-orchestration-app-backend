import prisma from '../db';
import { McpConnector, McpResponse } from './connectors/types';
import { HttpConnector } from './connectors/httpConnector';

class McpService {
  private connectors: Map<string, McpConnector> = new Map();

  constructor() {
    this.registerConnector(new HttpConnector());
    // Register other connectors here
  }

  public registerConnector(connector: McpConnector) {
    this.connectors.set(connector.type, connector);
  }

  public async executeMcpAction(resourceId: string, action: string, params: any): Promise<McpResponse> {
    const resource = await prisma.mCPResource.findUnique({
      where: { id: resourceId },
    });

    if (!resource) {
      throw new Error('Resource not found');
    }

    const connector = this.connectors.get(resource.type);

    if (!connector) {
      console.warn(`No connector found for resource type: ${resource.type}. Falling back to simulation.`);
      return { 
        status: 'success', 
        message: `Simulated ${action} on ${resource.type} resource: ${resource.name}`,
        data: params 
      };
    }

    return await connector.execute(action, params, resource.config);
  }
}

const mcpService = new McpService();
export const executeMcpAction = mcpService.executeMcpAction.bind(mcpService);
export default mcpService;
