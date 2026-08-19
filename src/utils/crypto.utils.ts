import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Returns a 32-byte Buffer key derived from the ENCRYPTION_KEY environment variable.
 */
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || 'orchestr_dev_encryption_key_32_bytes_long!!';
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plain text string using AES-256-GCM.
 * Returns formatted string: "iv:authTag:ciphertext"
 */
export function encrypt(text: string): string {
  if (!text) return text;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string ("iv:authTag:ciphertext").
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return ciphertext;

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    // Return original string if not in encrypted format (e.g. legacy/unencrypted data)
    return ciphertext;
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Encrypts an object payload to an encrypted JSON string.
 */
export function encryptJson(data: Record<string, any>): string {
  return encrypt(JSON.stringify(data));
}

/**
 * Decrypts an encrypted JSON string back to an object payload.
 */
export function decryptJson(ciphertext: string | Record<string, any>): Record<string, any> {
  if (typeof ciphertext === 'object' && ciphertext !== null) {
    return ciphertext;
  }
  const decryptedStr = decrypt(ciphertext);
  try {
    return JSON.parse(decryptedStr);
  } catch {
    return { raw: decryptedStr };
  }
}

/**
 * Sanitizes sensitive credentials for API responses by masking access tokens/keys.
 */
export function maskCredentials(credentials: Record<string, any>): Record<string, any> {
  if (!credentials || typeof credentials !== 'object') return {};

  const sanitized: Record<string, any> = { ...credentials };
  const sensitiveKeys = ['access_token', 'token', 'secret', 'password', 'api_key'];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((k) => key.toLowerCase().includes(k)) && typeof sanitized[key] === 'string') {
      const val = sanitized[key];
      if (val.length > 8) {
        sanitized[key] = val.substring(0, 4) + '****' + val.substring(val.length - 4);
      } else {
        sanitized[key] = '****';
      }
    }
  }

  return sanitized;
}
