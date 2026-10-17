import { Prisma } from "@prisma/client";
import axios from "axios";
import crypto from "node:crypto";
import prisma from "../db";
import { createExecution } from "../services/executionService";
import { openIntegrationConfig } from "../services/integrationConfigService";

interface TrelloConfig {
  apiKey: string;
  token: string;
  boardId: string;
  eligibleLabel: string;
  repositoryId: string;
}
interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  url: string;
  idList: string;
  labels: Array<{ name: string }>;
}
const asConfig = (value: Record<string, unknown>): TrelloConfig =>
  value as unknown as TrelloConfig;

export const syncTrelloConnection = async (connectionId: string) => {
  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });
  const config = asConfig(openIntegrationConfig(connection.encryptedConfig));
  const response = await axios.get<TrelloCard[]>(
    `https://api.trello.com/1/boards/${encodeURIComponent(config.boardId)}/cards`,
    {
      params: {
        key: config.apiKey,
        token: config.token,
        fields: "name,desc,url,idList,labels",
      },
      timeout: 15000,
    },
  );
  let ingested = 0;
  for (const card of response.data) {
    if (
      !card.labels.some(
        (label) =>
          label.name.toLowerCase() === config.eligibleLabel.toLowerCase(),
      )
    )
      continue;
    const revisionHash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          name: card.name,
          desc: card.desc,
          labels: card.labels,
          idList: card.idList,
        }),
      )
      .digest("hex");
    const item = await prisma.workItem.upsert({
      where: {
        externalSystem_externalId: {
          externalSystem: "TRELLO",
          externalId: card.id,
        },
      },
      create: {
        externalSystem: "TRELLO",
        externalId: card.id,
        boardId: config.boardId,
        projectId: connection.projectId,
        title: card.name,
        description: card.desc,
        labels: card.labels,
        sourceUrl: card.url,
        revisionHash,
        rawSnapshot: card as unknown as Prisma.InputJsonObject,
      },
      update: {
        title: card.name,
        description: card.desc,
        labels: card.labels,
        sourceUrl: card.url,
        revisionHash,
        rawSnapshot: card as unknown as Prisma.InputJsonObject,
      },
    });
    await createExecution({
      projectId: connection.projectId,
      repositoryId: config.repositoryId,
      workItemId: item.id,
      revisionHash,
    });
    ingested++;
  }
  await prisma.integrationConnection.update({
    where: { id: connectionId },
    data: { lastSyncedAt: new Date(), lastError: null },
  });
  return { ingested };
};

export const commentOnTrelloCard = async (
  connectionId: string,
  cardId: string,
  text: string,
) => {
  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where: { id: connectionId },
  });
  const config = asConfig(openIntegrationConfig(connection.encryptedConfig));
  await axios.post(
    `https://api.trello.com/1/cards/${encodeURIComponent(cardId)}/actions/comments`,
    null,
    {
      params: { key: config.apiKey, token: config.token, text },
      timeout: 15000,
    },
  );
};
