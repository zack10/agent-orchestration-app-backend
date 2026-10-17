import { Prisma } from "@prisma/client";
import axios from "axios";
import crypto from "node:crypto";
import { IssueTrackerAdapter, NormalizedWorkItem } from "./types";

interface TrelloConfig {
  apiKey: string;
  token: string;
  boardId: string;
  eligibleLabel: string;
  repositoryId: string;
}
export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  url: string;
  idList: string;
  labels: Array<{ name: string }>;
}
const asConfig = (value: Record<string, unknown>): TrelloConfig =>
  value as unknown as TrelloConfig;

/**
 * Filters cards to the eligible label and maps them to work items.
 * The revision hash formula is unchanged from the original adapter so
 * existing cards keep their execution idempotency keys.
 */
export const toWorkItems = (
  cards: TrelloCard[],
  config: Pick<TrelloConfig, "boardId" | "eligibleLabel">,
): NormalizedWorkItem[] =>
  cards
    .filter((card) =>
      card.labels.some(
        (label) =>
          label.name.toLowerCase() === config.eligibleLabel.toLowerCase(),
      ),
    )
    .map((card) => ({
      externalId: card.id,
      boardId: config.boardId,
      title: card.name,
      description: card.desc,
      labels: card.labels,
      sourceUrl: card.url,
      revisionHash: crypto
        .createHash("sha256")
        .update(
          JSON.stringify({
            name: card.name,
            desc: card.desc,
            labels: card.labels,
            idList: card.idList,
          }),
        )
        .digest("hex"),
      rawSnapshot: card as unknown as Prisma.InputJsonObject,
    }));

export const trelloAdapter: IssueTrackerAdapter = {
  type: "TRELLO",
  externalSystem: "TRELLO",

  async fetchEligibleItems(rawConfig) {
    const config = asConfig(rawConfig);
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
    return {
      repositoryId: config.repositoryId,
      items: toWorkItems(response.data, config),
    };
  },

  async comment(rawConfig, cardId, text) {
    const config = asConfig(rawConfig);
    await axios.post(
      `https://api.trello.com/1/cards/${encodeURIComponent(cardId)}/actions/comments`,
      null,
      {
        params: { key: config.apiKey, token: config.token, text },
        timeout: 15000,
      },
    );
  },
};
