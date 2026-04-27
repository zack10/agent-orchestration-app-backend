import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

/**
 * Encrypts a string using AES-256-GCM.
 * The output is in the format: iv:tag:encryptedData
 */
export const encrypt = (text: string): string => {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes).');
  }

  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
};

/**
 * Decrypts a string encrypted with the above encrypt function.
 */
export const decrypt = (encryptedText: string): string => {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes).');
  }

  const key = Buffer.from(keyHex, 'hex');
  const [ivHex, tagHex, encryptedData] = encryptedText.split(':');

  if (!ivHex || !tagHex || !encryptedData) {
    throw new Error('Invalid encrypted text format. Expected iv:tag:encryptedData');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};
