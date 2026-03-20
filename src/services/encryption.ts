/**
 * Encryption Service for Restart Our Love
 * Implements E2EE using Web Crypto API
 */

const ALGO_AES_GCM = 'AES-GCM';
const ALGO_PBKDF2 = 'PBKDF2';
const ALGO_ECDH = 'ECDH';
const ITERATIONS = 100000;
const SALT_SIZE = 16;
const IV_SIZE = 12;

export interface EncryptedData {
  ciphertext: string;
  iv: string;
}

/**
 * Derives a Key Encryption Key (KEK) from a PIN and salt
 */
export async function deriveKEK(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    ALGO_PBKDF2,
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: ALGO_PBKDF2,
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: ALGO_AES_GCM, length: 256 },
    true,
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Generates a random Content Key (CK)
 */
export async function generateCK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGO_AES_GCM, length: 256 },
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}

/**
 * Wraps a key with another key
 */
export async function wrapKey(keyToWrap: CryptoKey, wrappingKey: CryptoKey): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const wrapped = await crypto.subtle.wrapKey(
    'raw',
    keyToWrap,
    wrappingKey,
    { name: ALGO_AES_GCM, iv }
  );

  return {
    ciphertext: b64Encode(wrapped),
    iv: b64Encode(iv)
  };
}

/**
 * Unwraps a key
 */
export async function unwrapKey(wrappedData: EncryptedData, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const wrapped = b64Decode(wrappedData.ciphertext);
  const iv = b64Decode(wrappedData.iv);

  return crypto.subtle.unwrapKey(
    'raw',
    wrapped,
    wrappingKey,
    { name: ALGO_AES_GCM, iv },
    { name: ALGO_AES_GCM, length: 256 },
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}

/**
 * Encrypts text using a symmetric key
 */
export async function encryptText(text: string, key: CryptoKey): Promise<EncryptedData> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO_AES_GCM, iv },
    key,
    encoder.encode(text)
  );

  return {
    ciphertext: b64Encode(ciphertext),
    iv: b64Encode(iv)
  };
}

/**
 * Decrypts text using a symmetric key
 */
export async function decryptText(data: EncryptedData, key: CryptoKey): Promise<string> {
  const ciphertext = b64Decode(data.ciphertext);
  const iv = b64Decode(data.iv);
  const decoder = new TextDecoder();

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGO_AES_GCM, iv },
    key,
    ciphertext
  );

  return decoder.decode(decrypted);
}

// Helpers
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_SIZE));
}

export function b64Encode(buffer: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

export function b64Decode(str: string): Uint8Array {
  return new Uint8Array(atob(str).split('').map(c => c.charCodeAt(0)));
}

/**
 * Exports a key to a base64 string (for SSK sharing)
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('raw', key);
  return b64Encode(exported);
}

/**
 * Imports a key from a base64 string
 */
export async function importKey(b64: string): Promise<CryptoKey> {
  const buffer = b64Decode(b64);
  return crypto.subtle.importKey(
    'raw',
    buffer,
    ALGO_AES_GCM,
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}

/**
 * Creates a secure hash of a PIN for verification
 */
export async function hashPIN(pin: string, salt: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const combined = new Uint8Array(data.length + salt.length);
  combined.set(data);
  combined.set(salt, data.length);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  return b64Encode(hashBuffer);
}

/**
 * Generates an ECDH key pair for key exchange
 */
export async function generateExchangeKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: ALGO_ECDH, namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
}

/**
 * Derives a shared secret (Relationship Key) from a private key and a remote public key
 */
export async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: ALGO_ECDH, public: publicKey },
    privateKey,
    { name: ALGO_AES_GCM, length: 256 },
    true,
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Exports a public key to a base64 string
 */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('spki', key);
  return b64Encode(exported);
}

/**
 * Imports a public key from a base64 string
 */
export async function importPublicKey(b64: string): Promise<CryptoKey> {
  const buffer = b64Decode(b64);
  return crypto.subtle.importKey(
    'spki',
    buffer,
    { name: ALGO_ECDH, namedCurve: 'P-256' },
    true,
    []
  );
}

/**
 * Exports a private key (wrapped)
 */
export async function exportPrivateKey(key: CryptoKey, wrappingKey: CryptoKey): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const wrapped = await crypto.subtle.wrapKey(
    'pkcs8',
    key,
    wrappingKey,
    { name: ALGO_AES_GCM, iv }
  );

  return {
    ciphertext: b64Encode(wrapped),
    iv: b64Encode(iv)
  };
}

/**
 * Imports a private key (unwrapped)
 */
export async function importPrivateKey(wrappedData: EncryptedData, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const wrapped = b64Decode(wrappedData.ciphertext);
  const iv = b64Decode(wrappedData.iv);

  return crypto.subtle.unwrapKey(
    'pkcs8',
    wrapped,
    wrappingKey,
    { name: ALGO_AES_GCM, iv },
    { name: ALGO_ECDH, namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
}
