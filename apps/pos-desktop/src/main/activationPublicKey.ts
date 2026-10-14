/**
 * Public keys that activation keys are checked against; a key signed by any of them is
 * accepted. To rotate, append the new public key — never replace an old one, or every shop
 * activated with it would drop back to "not activated".
 *
 * PRE-RELEASE: the key below was generated during development (scripts/activation-keys.mjs
 * keygen). Before shipping, either move its private key to safe storage or generate a new
 * pair and put the new public key here. The private key must never be in this repository.
 */
export const ACTIVATION_PUBLIC_KEYS: string[] = [
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA4Xz4nv5WXN4dVNa6dT9yUqd6SvlpjltMihYiW8ZGQaE=
-----END PUBLIC KEY-----`,
];
