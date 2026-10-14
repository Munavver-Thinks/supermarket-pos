#!/usr/bin/env node
// Vendor tool for offline device activation. Not shipped with the app.
//
//   node scripts/activation-keys.mjs keygen <outDir>
//       Writes activation-private.pem and activation-public.pem into <outDir>.
//       Keep the private key OUT of the repository and in safe storage. Paste the public key
//       into electron/main/activationPublicKey.ts (append — never replace — so keys issued with an
//       older private key keep working).
//
//   node scripts/activation-keys.mjs issue <privateKeyPem> <requestCode> <storeName> [licenseId]
//       Prints an activation key for the request code shown on the shop's screen.
//
// The key format must match electron/main/activation.ts:
//   POS1.<base64url(JSON payload)>.<base64url(Ed25519 signature over the payload segment)>
import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(
    "Usage:\n" +
      "  node scripts/activation-keys.mjs keygen <outDir>\n" +
      "  node scripts/activation-keys.mjs issue <privateKeyPem> <requestCode> <storeName> [licenseId]\n",
  );
  process.exit(1);
}

function keygen(outDir) {
  if (!outDir) usage("keygen needs an output directory.");
  fs.mkdirSync(outDir, { recursive: true });
  const privatePath = path.join(outDir, "activation-private.pem");
  if (fs.existsSync(privatePath)) usage(`${privatePath} already exists; refusing to overwrite a private key.`);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  fs.writeFileSync(privatePath, privateKey, { mode: 0o600 });
  fs.writeFileSync(path.join(outDir, "activation-public.pem"), publicKey);
  process.stdout.write(`Wrote ${privatePath} (keep it secret) and activation-public.pem\n`);
}

function issue(privateKeyPath, requestCode, storeName, licenseId) {
  if (!privateKeyPath || !requestCode || !storeName) usage("issue needs a private key, a request code and a store name.");
  const code = requestCode.replace(/[^0-9a-z]/gi, "").toUpperCase();
  if (!/^[0-9A-F]{16}$/.test(code)) usage("The request code should be 16 letters/digits, e.g. 1A2B-3C4D-5E6F-7A8B.");
  const payload = {
    v: 1,
    licenseId: licenseId || randomUUID(),
    storeName,
    requestCode: code.match(/.{4}/g).join("-"),
    issuedAt: new Date().toISOString(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = createPrivateKey(fs.readFileSync(privateKeyPath, "utf8"));
  const signature = sign(null, Buffer.from(body), key).toString("base64url");
  process.stdout.write(`POS1.${body}.${signature}\n`);
}

const [command, ...args] = process.argv.slice(2);
if (command === "keygen") keygen(args[0]);
else if (command === "issue") issue(args[0], args[1], args[2], args[3]);
else usage();
