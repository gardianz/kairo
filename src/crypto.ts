// Wallet crypto, reverse-engineered + verified against the live Kairo wallet.
// gt(cantonKey, password)  = CryptoJS.AES.decrypt(cantonKey, password).toString(Utf8)
// Vt(hash, secret)         = base64(nacl.sign.detached(b64(hash), b64(secret)))
// pubFromSecret(secret)    = base64(nacl keypair.fromSecretKey(b64(secret)).publicKey)
import CryptoJS from "crypto-js";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

const { decodeBase64, encodeBase64 } = naclUtil;

// Decrypt the stored cantonKey with the wallet password -> ed25519 secret (base64).
export function decryptSecret(cantonKey: string, password: string): string {
  const secret = CryptoJS.AES.decrypt(cantonKey, password).toString(CryptoJS.enc.Utf8);
  if (!secret) throw new Error("Invalid key or secret. (wrong wallet password?)");
  return secret;
}

// Derive the ed25519 public key (base64) from a secret key (base64).
export function pubFromSecret(secretB64: string): string {
  return encodeBase64(nacl.sign.keyPair.fromSecretKey(decodeBase64(secretB64)).publicKey);
}

// Sign a base64 prepared-transaction hash with the base64 secret key.
export function signHash(hashB64: string, secretB64: string): string {
  return encodeBase64(nacl.sign.detached(decodeBase64(hashB64), decodeBase64(secretB64)));
}

// Verify a decrypted secret matches the wallet's stored public key.
export function verifySecret(secretB64: string, storedPublicKey: string): boolean {
  return pubFromSecret(secretB64) === storedPublicKey;
}
