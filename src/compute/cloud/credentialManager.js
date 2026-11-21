const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class CredentialManager {
  static STORAGE_DIR = path.resolve(
    process.env.STORAGE_LOCAL_DIR || "./storage_data",
    "credentials"
  );
  static ALGORITHM = "aes-256-gcm";

  static getEncryptionKey() {
    const rawSecret =
      process.env.ENCRYPTION_SECRET ||
      process.env.NEXTAUTH_SECRET ||
      "cinegen-ai-secure-encryption-key-2026-default-fallback-salt";
    return crypto.createHash("sha256").update(rawSecret).digest();
  }

  static getUserCredentialFilePath(userId) {
    const safeUserId = (userId || "default_user").replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!fs.existsSync(this.STORAGE_DIR)) {
      fs.mkdirSync(this.STORAGE_DIR, { recursive: true });
    }
    return path.join(this.STORAGE_DIR, `${safeUserId}.json`);
  }

  static maskApiKey(apiKey, provider) {
    if (!apiKey || apiKey.length < 8) return "••••••••";
    const prefix = provider === "runpod" ? "rpa_" : "vast_";
    const last4 = apiKey.slice(-4);
    return `${prefix}••••••••${last4}`;
  }

  static async saveCredential(userId, provider, apiKey) {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error("API key cannot be empty.");
    }

    const cleanKey = apiKey.trim();
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    let encrypted = cipher.update(cleanKey, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");

    const maskedKey = this.maskApiKey(cleanKey, provider);
    const record = {
      provider,
      encryptedKey: encrypted,
      iv: iv.toString("hex"),
      tag,
      maskedKey,
      updatedAt: new Date().toISOString(),
    };

    const filePath = this.getUserCredentialFilePath(userId);
    let records = {};
    if (fs.existsSync(filePath)) {
      try {
        records = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch {
        records = {};
      }
    }

    records[provider] = record;
    fs.writeFileSync(filePath, JSON.stringify(records, null, 2), { mode: 0o600 });

    return {
      provider,
      maskedKey,
      isConfigured: true,
      updatedAt: record.updatedAt,
    };
  }

  static async getDecryptedCredential(userId, provider) {
    const filePath = this.getUserCredentialFilePath(userId);
    if (!fs.existsSync(filePath)) return null;

    try {
      const records = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const record = records[provider];
      if (!record) return null;

      const key = this.getEncryptionKey();
      const iv = Buffer.from(record.iv, "hex");
      const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
      decipher.setAuthTag(Buffer.from(record.tag, "hex"));

      let decrypted = decipher.update(record.encryptedKey, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch {
      return null;
    }
  }

  static async getMaskedCredentials(userId) {
    const providers = ["runpod", "vast"];
    const filePath = this.getUserCredentialFilePath(userId);
    let records = {};

    if (fs.existsSync(filePath)) {
      try {
        records = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch {
        records = {};
      }
    }

    return providers.map((p) => {
      const rec = records[p];
      return {
        provider: p,
        maskedKey: rec ? rec.maskedKey : "Not Configured",
        isConfigured: !!rec,
        updatedAt: rec ? rec.updatedAt : undefined,
      };
    });
  }

  static async deleteCredential(userId, provider) {
    const filePath = this.getUserCredentialFilePath(userId);
    if (!fs.existsSync(filePath)) return false;

    try {
      const records = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (records[provider]) {
        delete records[provider];
        fs.writeFileSync(filePath, JSON.stringify(records, null, 2), { mode: 0o600 });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

module.exports = { CredentialManager };
