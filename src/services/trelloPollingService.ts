import { config } from "../config";
import prisma from "../db";
import { syncTrelloConnection } from "../integrations/trelloAdapter";
import { describeError } from "../utils/safeError";

let timer: NodeJS.Timeout | null = null;
let syncing = false;
const sync = async () => {
  const connections = await prisma.integrationConnection.findMany({
    where: { type: "TRELLO", enabled: true },
    select: { id: true },
  });
  for (const connection of connections)
    try {
      await syncTrelloConnection(connection.id);
    } catch (error) {
      const message = describeError(error);
      await prisma.integrationConnection.update({
        where: { id: connection.id },
        data: { lastError: message },
      });
      console.error(`Trello sync failed for ${connection.id}:`, message);
    }
};
const tick = async () => {
  if (syncing) return;
  syncing = true;
  try {
    await sync();
  } catch (error) {
    // A DB outage must not become an unhandled rejection (process exit).
    console.error(`Trello polling failed: ${describeError(error)}`);
  } finally {
    syncing = false;
  }
};
export const startTrelloPolling = async () => {
  await tick();
  timer = setInterval(() => void tick(), config.trelloPollIntervalMs);
  timer.unref();
};
export const stopTrelloPolling = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};
