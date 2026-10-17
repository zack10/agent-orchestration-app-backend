import axios from "axios";
import dns from "node:dns/promises";
import net from "node:net";
import { config as appConfig } from "../../config";
import {
  ConnectorConfig,
  ConnectorParams,
  McpConnector,
  McpResponse,
} from "./types";

const isPrivateIp = (address: string): boolean => {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
};

const validateTarget = async (rawUrl: unknown): Promise<URL> => {
  if (typeof rawUrl !== "string")
    throw new Error("HTTP connector URL is required");
  const target = new URL(rawUrl);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password
  ) {
    throw new Error(
      "HTTP connector target must be an HTTP(S) URL without embedded credentials",
    );
  }

  const hostname = target.hostname.toLowerCase();
  if (!appConfig.connectorAllowedHosts.includes(hostname)) {
    throw new Error(`HTTP connector host is not allowlisted: ${hostname}`);
  }

  const addresses = await dns.lookup(hostname, { all: true });
  if (
    !appConfig.connectorAllowPrivateIps &&
    addresses.some((item) => isPrivateIp(item.address))
  ) {
    throw new Error(
      `HTTP connector host resolves to a private address: ${hostname}`,
    );
  }
  return target;
};

export class HttpConnector implements McpConnector {
  type = "HTTP";

  async execute(
    action: string,
    params: ConnectorParams,
    config: ConnectorConfig,
  ): Promise<McpResponse> {
    try {
      const target = await validateTarget(config.url);
      const method =
        typeof config.method === "string" ? config.method.toUpperCase() : "GET";
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        throw new Error(`Unsupported HTTP method: ${method}`);
      }
      console.log(`[HttpConnector] Executing ${method} on ${target.origin}`);
      const response = await axios({
        method,
        url: target.toString(),
        data: params,
        params: method === "GET" ? params : undefined,
        timeout: appConfig.connectorTimeoutMs,
        maxContentLength: appConfig.connectorMaxResponseBytes,
        maxBodyLength: appConfig.connectorMaxResponseBytes,
        maxRedirects: 0,
      });

      return {
        status: "success",
        message: `Successfully executed ${action}`,
        data: response.data,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const responseData = axios.isAxiosError(error)
        ? error.response?.data
        : undefined;
      return {
        status: "error",
        message: `HTTP request failed: ${message}`,
        data: responseData,
      };
    }
  }
}
