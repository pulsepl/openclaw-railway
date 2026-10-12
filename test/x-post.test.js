import test from "node:test";
import assert from "node:assert/strict";
import { oauthSignature, oauthHeader, percentEncode } from "../src/x-post.mjs";

// Worked example from X/Twitter's "Creating a signature" documentation.
test("OAuth 1.0a signature matches the documented example", () => {
  const sig = oauthSignature({
    method: "POST",
    url: "https://api.twitter.com/1.1/statuses/update.json",
    params: {
      include_entities: "true",
      status: "Hello Ladies + Gentlemen, a signed OAuth request!",
      oauth_consumer_key: "xvz1evFS4wEEPTGEFPHBog",
      oauth_nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: "1318622958",
      oauth_token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
      oauth_version: "1.0",
    },
    consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
    tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
  });
  assert.equal(sig, "hCtSmYh+iHYCEqBWrE7C7hYmtUk=");
});

test("percent-encoding follows RFC 3986", () => {
  assert.equal(percentEncode("Ladies + Gentlemen!*()'"), "Ladies%20%2B%20Gentlemen%21%2A%28%29%27");
});

test("Authorization header has all oauth fields", () => {
  const h = oauthHeader({
    method: "POST",
    url: "https://api.x.com/2/tweets",
    creds: { apiKey: "k", apiSecret: "s", accessToken: "t", accessTokenSecret: "ts" },
    nonce: "n",
    timestamp: 1,
  });
  for (const f of ["oauth_consumer_key", "oauth_nonce", "oauth_signature", "oauth_signature_method", "oauth_timestamp", "oauth_token", "oauth_version"]) {
    assert.match(h, new RegExp(`${f}="`));
  }
});
