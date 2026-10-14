import { generateKeyPairSync } from "node:crypto";

import { createDb, runMigrations, seedRepo, type Db } from "@pos/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeRequestCode, getActivationStatus, setActivationStatus, signActivationPayload } from "../../../../electron/main/activation.js";
import { activateDevice, initActivation } from "../../../../electron/main/activationService.js";
import type { DeviceConfig } from "../../../../electron/main/deviceConfigFile.js";
import { NOT_ACTIVATED_MESSAGE, safeHandle, type HandlerContext } from "../../../../electron/main/ipc/common.js";

const vendor = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const build = { isPackaged: true, forceActivation: false, publicKeys: [vendor.publicKey] };

describe("device activation flow", () => {
  let db: Db;
  let config: DeviceConfig;

  beforeEach(async () => {
    db = createDb({ filePath: ":memory:" });
    await runMigrations(db);
    const seed = await seedRepo.seedFirstRun(db, {
      organizationName: "Org",
      storeName: "Store",
      deviceName: "Register",
      ownerUsername: "owner",
      ownerPasswordHash: "hash",
      ownerDisplayName: "Owner",
    });
    config = {
      organizationId: seed.organizationId,
      storeId: seed.storeId,
      deviceId: seed.deviceId,
      counterId: "counter-1",
      billNoPrefix: "POS",
      activationRequired: true,
    };
  });

  afterEach(async () => {
    await db.destroy();
  });

  function keyFor(deviceId: string): string {
    return signActivationPayload(
      {
        v: 1,
        licenseId: "LIC-9",
        storeName: "Store",
        requestCode: computeRequestCode(deviceId),
        issuedAt: "2026-09-16T00:00:00.000Z",
      },
      vendor.privateKey,
    );
  }

  it("seeds new devices as not yet activated", async () => {
    const device = await db.selectFrom("devices").selectAll().executeTakeFirstOrThrow();
    expect(device.activatedAt).toBeNull();
  });

  it("stores a valid key on the device row and in the config, without a restart", async () => {
    expect(initActivation(config, build).status).toBe("unactivated");
    const saveConfig = vi.fn();
    const key = keyFor(config.deviceId);

    const result = await activateDevice(db, config, `  ${key}\n`, { ...build, saveConfig });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.activation).toMatchObject({ status: "activated", licenseId: "LIC-9" });

    expect(saveConfig).toHaveBeenCalledWith(expect.objectContaining({ activationKey: key, activationRequired: true }));
    expect(config.activationKey).toBe(key);
    const device = await db.selectFrom("devices").selectAll().executeTakeFirstOrThrow();
    expect(device.activationKey).toBe(key);
    expect(device.activatedAt).not.toBeNull();
  });

  it("changes nothing for a key issued to another computer", async () => {
    const saveConfig = vi.fn();
    const before = await db.selectFrom("devices").selectAll().executeTakeFirstOrThrow();

    const result = await activateDevice(db, config, keyFor("some-other-device"), { ...build, saveConfig });
    expect(result).toEqual({ ok: false, error: "That activation key was issued for a different computer." });

    expect(saveConfig).not.toHaveBeenCalled();
    expect(config.activationKey).toBeUndefined();
    expect(await db.selectFrom("devices").selectAll().executeTakeFirstOrThrow()).toEqual(before);
  });

  it("lets a legacy install activate as well", async () => {
    const legacy: DeviceConfig = { ...config };
    delete legacy.activationRequired;
    expect(initActivation(legacy, build).status).toBe("not_activated_legacy");
    const result = await activateDevice(db, legacy, keyFor(legacy.deviceId), { ...build, saveConfig: () => undefined });
    expect(result.ok && result.activation.status).toBe("activated");
  });
});

describe("safeHandle activation gate", () => {
  const ctx = {
    getDb: () => ({}) as Db,
    deviceConfig: { storeId: "s" },
  } as unknown as HandlerContext;
  const event = {} as Parameters<ReturnType<typeof safeHandle>>[0];

  afterEach(() => {
    setActivationStatus({
      status: "developer",
      requestCode: "",
      licenseId: null,
      storeName: null,
      issuedAt: null,
      reason: null,
    });
  });

  function setStatus(status: "unactivated" | "not_activated_legacy" | "activated" | "developer"): void {
    setActivationStatus({ status, requestCode: "X", licenseId: null, storeName: null, issuedAt: null, reason: null });
  }

  it("refuses everything except activation and error reporting while unactivated", async () => {
    setStatus("unactivated");
    const run = vi.fn(async () => ({ ok: true }));
    expect(await safeHandle(ctx, "billing:createSale", run)(event)).toEqual({ ok: false, error: NOT_ACTIVATED_MESSAGE });
    expect(await safeHandle(ctx, "auth:login", run)(event)).toEqual({ ok: false, error: NOT_ACTIVATED_MESSAGE });
    expect(run).not.toHaveBeenCalled();

    expect(await safeHandle(ctx, "activation:activate", run)(event)).toEqual({ ok: true });
    expect(await safeHandle(ctx, "errors:reportRenderer", run)(event)).toEqual({ ok: true });
    expect(getActivationStatus()?.status).toBe("unactivated");
  });

  it("never gates legacy, activated or development installs", async () => {
    for (const status of ["not_activated_legacy", "activated", "developer"] as const) {
      setStatus(status);
      expect(await safeHandle(ctx, "billing:createSale", async () => ({ ok: true }))(event)).toEqual({ ok: true });
    }
  });
});
