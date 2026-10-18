import { ORCID_CLIENT_ID, type OrcidKey } from "../orcid-proof";
import { toBase64Url } from "../share-link";

/**
 * A stand-in for ORCID's token signing, for unit and end-to-end tests: a fresh
 * RSA key, its public half as ORCID's JWKS publishes it, and id_tokens signed
 * the way ORCID signs them.
 */
const ALGORITHM = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};
const KID = "test-key";
export const TEST_ORCID = "0000-0002-1825-0097";

const encode = (value: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));

/** `now` sets the default issue time, in epoch milliseconds. Claims and header passed to `sign` override the defaults. */
export async function testIssuer(now = Date.now()) {
  const pair = (await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"])) as CryptoKeyPair;
  const keys = [{ ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: KID } as OrcidKey];
  async function sign(claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
    const head = encode({ alg: "RS256", kid: KID, ...header });
    const iat = Math.floor(now / 1000) - 30;
    const body = encode({
      iss: "https://orcid.org",
      aud: ORCID_CLIENT_ID,
      sub: TEST_ORCID,
      iat,
      exp: iat + 600,
      auth_time: iat,
      given_name: "Bob",
      family_name: "White",
      ...claims,
    });
    const signature = await crypto.subtle.sign(
      ALGORITHM.name,
      pair.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    );
    return `${head}.${body}.${toBase64Url(new Uint8Array(signature))}`;
  }
  return { keys, sign };
}
