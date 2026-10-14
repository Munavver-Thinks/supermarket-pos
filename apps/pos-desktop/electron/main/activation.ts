import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

import type { ActivationInfo } from "@pos/types";

/**
 * Offline device activation. The vendor signs a small payload naming this device's request
 * code with an Ed25519 private key; the app checks the signature with the public key it ships
 * with. No network is involved.
 *
 * What this is: a deterrent against casually copying the installer onto another PC. What it is
 * not: protection. Anyone who edits device-config.json, copies the whole data folder (which
 * carries the activation with it) or patches the app gets past it.
 *
 * Key format: `POS1.<base64url(JSON payload)>.<base64url(signature)>`, signature over the
 * payload segment's bytes.
 *
 * Only node:crypto here, so it is unit-tested without Electron.
 */

export const KEY_PREFIX = "POS1";

export interface ActivationPayload {
  v: 1;
  licenseId: string;
  storeName: string;
  /** The request code the key was issued for, as the app shows it. */
  requestCode: string;
  issuedAt: string;
}

export type VerifyResult = { ok: true; payload: ActivationPayload } | { ok: false; reason: string };

/**
 * What the shop reads out to the vendor. Derived from the install's device id only — not the
 * PC name — so renaming the computer doesn't undo an activation.
 */
export function computeRequestCode(deviceId: string): string {
  const hex = createHash("sha256").update(`${KEY_PREFIX}|${deviceId}`).digest("hex").slice(0, 16).toUpperCase();
  return hex.match(/.{4}/g)?.join("-") ?? hex;
}

function normaliseCode(code: string): string {
  return code.replace(/[^0-9a-z]/gi, "").toUpperCase();
}

function toBase64Url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

export function signActivationPayload(payload: ActivationPayload, privateKeyPem: string): string {
  const body = toBase64Url(JSON.stringify(payload));
  const signature = sign(null, Buffer.from(body), createPrivateKey(privateKeyPem));
  return `${KEY_PREFIX}.${body}.${toBase64Url(signature)}`;
}

function isPayload(value: unknown): value is ActivationPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v["v"] === 1 &&
    typeof v["licenseId"] === "string" &&
    typeof v["storeName"] === "string" &&
    typeof v["requestCode"] === "string" &&
    typeof v["issuedAt"] === "string"
  );
}

/**
 * Checks a key against this device's request code with any of the given public keys. Never
 * throws: a malformed key is a reason, not an exception.
 */
export function verifyActivationKey(
  key: string,
  expectedRequestCode: string,
  publicKeyPem: string | readonly string[],
): VerifyResult {
  const compact = key.replace(/\s+/g, "");
  const parts = compact.split(".");
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX || !parts[1] || !parts[2]) {
    return { ok: false, reason: "That doesn't look like an activation key." };
  }
  const [, body, signatureText] = parts as [string, string, string];

  let signature: Buffer;
  let payload: unknown;
  try {
    signature = Buffer.from(signatureText, "base64url");
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "That activation key is damaged. Copy it again exactly as issued." };
  }

  const keys = typeof publicKeyPem === "string" ? [publicKeyPem] : publicKeyPem;
  const signed = keys.some((pem) => {
    try {
      return verify(null, Buffer.from(body), createPublicKey(pem), signature);
    } catch {
      return false;
    }
  });
  if (!signed) {
    return { ok: false, reason: "That activation key is not valid. Copy it again exactly as issued." };
  }
  if (!isPayload(payload)) {
    return { ok: false, reason: "That activation key is from an unsupported version." };
  }
  if (normaliseCode(payload.requestCode) !== normaliseCode(expectedRequestCode)) {
    return { ok: false, reason: "That activation key was issued for a different computer." };
  }
  return { ok: true, payload };
}

export interface ActivationConfigView {
  deviceId: string;
  activationKey?: string | undefined;
  activationRequired?: boolean | undefined;
}

/**
 * Pure: the device's activation state from its config and build.
 * - A development run (not packaged, and POS_FORCE_ACTIVATION not set) is never gated.
 * - A stored key that verifies means activated.
 * - Otherwise a config written by this release's first run is gated; an older config is not
 *   (existing shops keep billing and can activate from Settings).
 * A stored key that fails is left exactly where it is; only the reason is reported.
 */
export function resolveActivationStatus(input: {
  config: ActivationConfigView;
  isPackaged: boolean;
  forceActivation: boolean;
  publicKeys: readonly string[];
}): ActivationInfo {
  const requestCode = computeRequestCode(input.config.deviceId);
  const stored = input.config.activationKey?.trim();
  const verified = stored ? verifyActivationKey(stored, requestCode, input.publicKeys) : null;
  const developer = !input.isPackaged && !input.forceActivation;

  const licence =
    verified?.ok === true
      ? { licenseId: verified.payload.licenseId, storeName: verified.payload.storeName, issuedAt: verified.payload.issuedAt }
      : { licenseId: null, storeName: null, issuedAt: null };
  const reason = verified && !verified.ok ? verified.reason : null;

  if (developer) return { status: "developer", requestCode, ...licence, reason };
  if (verified?.ok) return { status: "activated", requestCode, ...licence, reason: null };
  return {
    status: input.config.activationRequired === true ? "unactivated" : "not_activated_legacy",
    requestCode,
    ...licence,
    reason,
  };
}

let current: ActivationInfo | null = null;

/** The state resolved at boot (or after activating). Null only before boot finishes. */
export function getActivationStatus(): ActivationInfo | null {
  return current;
}

export function setActivationStatus(info: ActivationInfo): void {
  current = info;
}
