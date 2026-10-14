import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readDeviceConfigFile, writeDeviceConfigFile, type DeviceConfig } from "../../../../electron/main/deviceConfigFile.js";

const BASE: DeviceConfig = {
  organizationId: "org",
  storeId: "store",
  deviceId: "device",
  counterId: "counter-1",
  billNoPrefix: "POS",
};

describe("device-config.json", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pos-config-"));
    file = path.join(dir, "device-config.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads nothing when there is no file", () => {
    expect(readDeviceConfigFile(file)).toBeUndefined();
  });

  it("reads an old config with no activation fields", () => {
    fs.writeFileSync(file, JSON.stringify(BASE));
    expect(readDeviceConfigFile(file)).toEqual(BASE);
  });

  it("tolerates unknown fields and ignores activation fields of the wrong type", () => {
    fs.writeFileSync(file, JSON.stringify({ ...BASE, futureThing: 1, activationKey: 42, activationRequired: "yes" }));
    const read = readDeviceConfigFile(file);
    expect(read).toMatchObject(BASE);
    expect(read?.activationKey).toBeUndefined();
    expect(read?.activationRequired).toBeUndefined();
  });

  it("still refuses a config missing a required field", () => {
    fs.writeFileSync(file, JSON.stringify({ ...BASE, storeId: undefined }));
    expect(() => readDeviceConfigFile(file)).toThrow(/storeId/);
  });

  it("writes atomically and keeps fields it doesn't know about", () => {
    fs.writeFileSync(file, JSON.stringify({ ...BASE, futureThing: { keep: true } }));
    writeDeviceConfigFile(file, { ...BASE, activationKey: "POS1.a.b" });

    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(raw["futureThing"]).toEqual({ keep: true });
    expect(raw["activationKey"]).toBe("POS1.a.b");
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(readDeviceConfigFile(file)).toMatchObject({ ...BASE, activationKey: "POS1.a.b" });
  });

  it("creates the file on first run", () => {
    writeDeviceConfigFile(file, { ...BASE, activationRequired: true });
    expect(readDeviceConfigFile(file)).toEqual({ ...BASE, activationRequired: true });
  });
});
