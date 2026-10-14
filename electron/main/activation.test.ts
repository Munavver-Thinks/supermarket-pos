import { execFileSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  computeRequestCode,
  resolveActivationStatus,
  signActivationPayload,
  verifyActivationKey,
  type ActivationPayload,
} from "./activation.js";
import { ACTIVATION_PUBLIC_KEYS } from "./activationPublicKey.js";

function keypair() {
  return generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
}

const vendor = keypair();
const other = keypair();
const DEVICE = "0b5b1f4e-3a52-4d6f-9c1c-0f0e1a2b3c4d";
const CODE = computeRequestCode(DEVICE);

function payload(overrides: Partial<ActivationPayload> = {}): ActivationPayload {
  return {
    v: 1,
    licenseId: "LIC-1",
    storeName: "Murugan Stores",
    requestCode: CODE,
    issuedAt: "2026-09-16T10:00:00.000Z",
    ...overrides,
  };
}

describe("computeRequestCode", () => {
  it("is 16 hex characters in four groups, fixed for a device id", () => {
    expect(CODE).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(computeRequestCode(DEVICE)).toBe(CODE);
    expect(computeRequestCode("another-device")).not.toBe(CODE);
  });

  it("does not depend on the computer's name", () => {
    const before = computeRequestCode(DEVICE);
    const original = os.hostname;
    Object.defineProperty(os, "hostname", { value: () => "RENAMED-PC", configurable: true });
    try {
      expect(computeRequestCode(DEVICE)).toBe(before);
    } finally {
      Object.defineProperty(os, "hostname", { value: original, configurable: true });
    }
  });
});

describe("verifyActivationKey", () => {
  const key = signActivationPayload(payload(), vendor.privateKey);

  it("accepts a key issued for this request code", () => {
    const result = verifyActivationKey(key, CODE, vendor.publicKey);
    expect(result).toEqual({ ok: true, payload: payload() });
  });

  it("accepts the code without dashes or in lower case, and a key pasted with line breaks", () => {
    expect(verifyActivationKey(key, CODE.replace(/-/g, "").toLowerCase(), vendor.publicKey).ok).toBe(true);
    const wrapped = `${key.slice(0, 30)}\n  ${key.slice(30)}\n`;
    expect(verifyActivationKey(wrapped, CODE, vendor.publicKey).ok).toBe(true);
  });

  it("accepts any of several public keys", () => {
    expect(verifyActivationKey(key, CODE, [other.publicKey, vendor.publicKey]).ok).toBe(true);
  });

  it("refuses a key issued for another request code", () => {
    const foreign = signActivationPayload(payload({ requestCode: computeRequestCode("x") }), vendor.privateKey);
    expect(verifyActivationKey(foreign, CODE, vendor.publicKey)).toEqual({
      ok: false,
      reason: "That activation key was issued for a different computer.",
    });
  });

  it("refuses a tampered payload", () => {
    const [prefix, , signature] = key.split(".");
    const forged = Buffer.from(JSON.stringify(payload({ storeName: "Someone Else" }))).toString("base64url");
    expect(verifyActivationKey(`${prefix}.${forged}.${signature}`, CODE, vendor.publicKey).ok).toBe(false);
  });

  it("refuses a key signed by a different private key", () => {
    const wrongSigner = signActivationPayload(payload(), other.privateKey);
    expect(verifyActivationKey(wrongSigner, CODE, vendor.publicKey).ok).toBe(false);
  });

  it("refuses malformed strings without throwing", () => {
    for (const junk of ["", "hello", "POS1..", "POS2.a.b", "POS1.!!!.???", "POS1.e30.AAAA", "a.b.c.d"]) {
      const result = verifyActivationKey(junk, CODE, vendor.publicKey);
      expect(result.ok).toBe(false);
    }
    expect(verifyActivationKey(key, CODE, "not a pem").ok).toBe(false);
  });

  it("refuses a well-signed payload of an unknown version", () => {
    const future = signActivationPayload({ ...payload(), v: 2 } as unknown as ActivationPayload, vendor.privateKey);
    expect(verifyActivationKey(future, CODE, vendor.publicKey)).toEqual({
      ok: false,
      reason: "That activation key is from an unsupported version.",
    });
  });
});

describe("resolveActivationStatus", () => {
  const validKey = signActivationPayload(payload(), vendor.privateKey);
  const base = { isPackaged: true, forceActivation: false, publicKeys: [vendor.publicKey] };

  it("gates a fresh install with no key", () => {
    const info = resolveActivationStatus({ ...base, config: { deviceId: DEVICE, activationRequired: true } });
    expect(info).toMatchObject({ status: "unactivated", requestCode: CODE, licenseId: null, reason: null });
  });

  it("never gates an install from before activation existed", () => {
    const info = resolveActivationStatus({ ...base, config: { deviceId: DEVICE } });
    expect(info.status).toBe("not_activated_legacy");
  });

  it("reports activated, with licence details from the key itself", () => {
    const info = resolveActivationStatus({
      ...base,
      config: { deviceId: DEVICE, activationRequired: true, activationKey: validKey },
    });
    expect(info).toEqual({
      status: "activated",
      requestCode: CODE,
      licenseId: "LIC-1",
      storeName: "Murugan Stores",
      issuedAt: "2026-09-16T10:00:00.000Z",
      reason: null,
    });
  });

  it("activates a legacy install too once a valid key is stored", () => {
    expect(resolveActivationStatus({ ...base, config: { deviceId: DEVICE, activationKey: validKey } }).status).toBe(
      "activated",
    );
  });

  it("falls back, with the reason, when a stored key has been tampered with — and changes nothing", () => {
    const tampered = `${validKey.slice(0, -4)}AAAA`;
    const config = { deviceId: DEVICE, activationRequired: true, activationKey: tampered };
    const snapshot = JSON.stringify(config);
    const gated = resolveActivationStatus({ ...base, config });
    expect(gated.status).toBe("unactivated");
    expect(gated.reason).toMatch(/not valid/);
    expect(JSON.stringify(config)).toBe(snapshot);

    const legacy = resolveActivationStatus({ ...base, config: { deviceId: DEVICE, activationKey: tampered } });
    expect(legacy.status).toBe("not_activated_legacy");
  });

  it("does not gate development runs unless activation is forced", () => {
    const dev = resolveActivationStatus({
      ...base,
      isPackaged: false,
      config: { deviceId: DEVICE, activationRequired: true },
    });
    expect(dev.status).toBe("developer");

    const forced = resolveActivationStatus({
      ...base,
      isPackaged: false,
      forceActivation: true,
      config: { deviceId: DEVICE, activationRequired: true },
    });
    expect(forced.status).toBe("unactivated");
  });

  it("treats a key for another device as not activated", () => {
    const foreign = signActivationPayload(payload({ requestCode: computeRequestCode("x") }), vendor.privateKey);
    const info = resolveActivationStatus({
      ...base,
      config: { deviceId: DEVICE, activationRequired: true, activationKey: foreign },
    });
    expect(info).toMatchObject({ status: "unactivated", reason: "That activation key was issued for a different computer." });
  });
});

describe("vendor script", () => {
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/activation-keys.mjs");
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-activation-"));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("issues keys the app accepts", () => {
    execFileSync(process.execPath, [script, "keygen", dir]);
    const publicKey = fs.readFileSync(path.join(dir, "activation-public.pem"), "utf8");
    const key = execFileSync(process.execPath, [
      script,
      "issue",
      path.join(dir, "activation-private.pem"),
      CODE.replace(/-/g, "").toLowerCase(),
      "Test Store",
    ])
      .toString()
      .trim();

    const result = verifyActivationKey(key, CODE, publicKey);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.storeName).toBe("Test Store");
    // A key from a different vendor keypair is not accepted by the keys the app ships with.
    expect(verifyActivationKey(key, CODE, ACTIVATION_PUBLIC_KEYS).ok).toBe(false);
  });

  it("ships only well-formed Ed25519 public keys", () => {
    expect(ACTIVATION_PUBLIC_KEYS.length).toBeGreaterThan(0);
    for (const pem of ACTIVATION_PUBLIC_KEYS) {
      expect(createPublicKey(pem).asymmetricKeyType).toBe("ed25519");
    }
  });

  it("refuses to overwrite an existing private key", () => {
    expect(() => execFileSync(process.execPath, [script, "keygen", dir], { stdio: "pipe" })).toThrow();
  });
});
