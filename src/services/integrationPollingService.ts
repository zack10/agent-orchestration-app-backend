import { config } from "../config";
import prisma from "../db";
import { trackerIntegrationTypes } from "../integrations/trackerRegistry";
import { describeError } from "../utils/safeError";
import { syncIntegrationConnection } from "./ingestionService";

let timer: NodeJS.Timeout | null = null;
let syncing = false;
const sync = async () => {
  const connections = await prisma.integrationConnection.findMany({
    where: { type: { in: trackerIntegrationTypes() }, enabled: true },
    select: { id: true, type: true },
  });
  for (const connection of connections)
    try {
      await syncIntegrationConnection(connection.id);
    } catch (error) {
      const message = describeError(error);
      await prisma.integrationConnection.update({
        where: { id: connection.id },
        data: { lastError: message },
      });
      console.error(
        `${connection.type} sync failed for ${connection.id}:`,
        message,
      );
    }
};
const tick = async () => {
  if (syncing) return;
  syncing = true;
  try {
    await sync();
  } catch (error) {
    // A DB outage must not become an unhandled rejection (process exit).
    console.error(`Integration polling failed: ${describeError(error)}`);
  } finally {
    syncing = false;
  }
};
export const startIntegrationPolling = async () => {
  await tick();
  timer = setInterval(() => void tick(), config.integrationPollIntervalMs);
  timer.unref();
};
export const stopIntegrationPolling = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};
