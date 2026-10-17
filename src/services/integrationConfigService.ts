import { decrypt, encrypt } from "../utils/crypto";

export const sealIntegrationConfig = (config: Record<string, unknown>) => ({
  ciphertext: encrypt(JSON.stringify(config)),
});

export const openIntegrationConfig = (
  value: unknown,
): Record<string, unknown> => {
  if (!value || typeof value !== "object" || !("ciphertext" in value))
    throw new Error("Invalid encrypted integration config");
  const ciphertext = (value as { ciphertext?: unknown }).ciphertext;
  if (typeof ciphertext !== "string")
    throw new Error("Invalid encrypted integration config");
  return JSON.parse(decrypt(ciphertext)) as Record<string, unknown>;
};

export const redactIntegration = <T extends { encryptedConfig: unknown }>(
  connection: T,
) => {
  const safe = { ...connection } as Omit<T, "encryptedConfig"> & {
    encryptedConfig?: unknown;
  };
  delete safe.encryptedConfig;
  return { ...safe, config: { configured: true } };
};
