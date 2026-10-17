import { ExternalSystem, IntegrationType } from "@prisma/client";
import { trelloAdapter } from "./trelloAdapter";
import { IssueTrackerAdapter } from "./types";

const byType = new Map<IntegrationType, IssueTrackerAdapter>();
const bySystem = new Map<ExternalSystem, IssueTrackerAdapter>();

export const registerTrackerAdapter = (adapter: IssueTrackerAdapter) => {
  byType.set(adapter.type, adapter);
  bySystem.set(adapter.externalSystem, adapter);
};

registerTrackerAdapter(trelloAdapter);
// Register other tracker adapters here.

/** Adapter for an IntegrationConnection type, or undefined if it isn't a tracker (e.g. GITHUB). */
export const getTrackerAdapter = (type: IntegrationType) => byType.get(type);

/** Adapter that owns work items from an external system. */
export const getTrackerAdapterForSystem = (system: ExternalSystem) =>
  bySystem.get(system);

export const trackerIntegrationTypes = (): IntegrationType[] => [
  ...byType.keys(),
];
