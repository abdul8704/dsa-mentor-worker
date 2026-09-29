/**
 * App-level encryption for third-party credentials we must hold on a
 * mentee's behalf (currently: a CSES session cookie — see
 * repository/userPlatformSecrets.repo.ts and CSES_INTEGRATION_PLAN.md §3.3).
 *
 * Deliberately NOT stored via Supabase pgcrypto: encrypting here means the
 * plaintext never has to pass through a raw SQL string, and the key never
 * has to live inside the database itself.
 *
 * CSES_SECRET_ENCRYPTION_KEY must be 32 random bytes, base64-encoded, e.g.:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Rotating this key invalidates every stored secret — mentees would need to
 * re-paste their CSES cookie.
 */
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

const getKey = (): Buffer => {
    const raw = process.env.CSES_SECRET_ENCRYPTION_KEY;
    if (!raw) {
        throw new Error("CSES_SECRET_ENCRYPTION_KEY is not set (see .env.example)");
    }
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
        throw new Error("CSES_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded)");
    }
    return key;
};

/** Encrypts `plaintext`. Stored format: base64(iv):base64(authTag):base64(ciphertext). */
export const encryptSecret = (plaintext: string): string => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [iv, authTag, ciphertext].map((buf) => buf.toString("base64")).join(":");
};

export const decryptSecret = (stored: string): string => {
    const [ivB64, tagB64, dataB64] = stored.split(":");
    if (!ivB64 || !tagB64 || !dataB64) {
        throw new Error("Malformed encrypted secret");
    }
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
};
