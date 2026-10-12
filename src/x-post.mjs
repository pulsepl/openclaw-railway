#!/usr/bin/env node
// x-post: minimal, dependency-free X (Twitter) poster for the OpenClaw agent.
//
// Only what the marketing bot needs: publish a post (optionally as a reply in a thread
// on our own account), delete one of our own posts, and check which account the keys
// belong to. No DMs, likes, follows or reads of other users.
//
// Credentials come from environment variables (set them in Railway, never in chat):
//   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
// Optional:
//   X_POST_DAILY_CAP   max posts per UTC day (default 6)
//   X_POST_LOG         JSONL log path (default /data/workspace/x-posts.log.jsonl)
//
// Usage:
//   node /app/src/x-post.mjs post "text"                 publish a post
//   node /app/src/x-post.mjs post --reply-to <id> "text" reply (e.g. thread on our own post)
//   node /app/src/x-post.mjs post --dry-run "text"       validate only, nothing is sent
//   node /app/src/x-post.mjs delete <post id>            delete one of our posts
//   node /app/src/x-post.mjs whoami                      show the account the keys post as
//   node /app/src/x-post.mjs log [n]                     show the last n logged actions
//
// Pricing note (pay-per-use API): each post costs credits; posts containing a link cost
// much more, so keep links to about one post per day.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const API = "https://api.x.com/2";
const DAILY_CAP = Math.max(1, Number.parseInt(process.env.X_POST_DAILY_CAP || "6", 10) || 6);
const LOG_PATH = process.env.X_POST_LOG || "/data/workspace/x-posts.log.jsonl";
const MAX_CHARS = 280;

export function percentEncode(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

// OAuth 1.0a HMAC-SHA1 signature (RFC 5849). `params` holds query and form-body params
// (JSON bodies are not part of the signature).
export function oauthSignature({ method, url, params, consumerSecret, tokenSecret }) {
  const pairs = Object.entries(params)
    .map(([k, v]) => [percentEncode(k), percentEncode(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const paramString = pairs.map(([k, v]) => `${k}=${v}`).join("&");
  const base = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join("&");
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret || "")}`;
  return crypto.createHmac("sha1", key).update(base).digest("base64");
}

export function oauthHeader({ method, url, query = {}, creds, nonce, timestamp }) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const signature = oauthSignature({
    method,
    url,
    params: { ...query, ...oauth },
    consumerSecret: creds.apiSecret,
    tokenSecret: creds.accessTokenSecret,
  });
  const all = { ...oauth, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(all)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(all[k])}"`)
      .join(", ")
  );
}

function loadCreds() {
  const creds = {
    apiKey: process.env.X_API_KEY?.trim(),
    apiSecret: process.env.X_API_SECRET?.trim(),
    accessToken: process.env.X_ACCESS_TOKEN?.trim(),
    accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET?.trim(),
  };
  const missing = Object.entries({
    X_API_KEY: creds.apiKey,
    X_API_SECRET: creds.apiSecret,
    X_ACCESS_TOKEN: creds.accessToken,
    X_ACCESS_TOKEN_SECRET: creds.accessTokenSecret,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    fail(`Missing X credentials: ${missing.join(", ")}. Ask Stef to add them as Railway variables.`);
  }
  return creds;
}

function readLog() {
  try {
    return fs
      .readFileSync(LOG_PATH, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function appendLog(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch (err) {
    console.error(`warning: could not write log ${LOG_PATH}: ${String(err)}`);
  }
}

function postsToday() {
  const day = new Date().toISOString().slice(0, 10);
  return readLog().filter((e) => e.action === "post" && e.ok && String(e.at).startsWith(day)).length;
}

function fail(msg, code = 1) {
  console.error(`x-post: ${msg}`);
  process.exit(code);
}

async function callX(method, endpoint, { body } = {}) {
  const creds = loadCreds();
  const url = `${API}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization: oauthHeader({ method, url, creds }),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

async function cmdPost(args) {
  let dryRun = false;
  let replyTo = null;
  const words = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--reply-to") replyTo = args[++i];
    else words.push(args[i]);
  }
  const text = words.join(" ").trim();
  if (!text) fail('Nothing to post. Usage: post "text"');
  const length = [...text].length;
  if (length > MAX_CHARS) fail(`Post is ${length} characters; the limit is ${MAX_CHARS}.`);
  if (replyTo && !/^\d+$/.test(replyTo)) fail("--reply-to needs a numeric post id.");
  const today = postsToday();
  if (today >= DAILY_CAP) fail(`Daily cap reached (${today}/${DAILY_CAP} posts today, UTC). Try again tomorrow.`);
  const hasLink = /https?:\/\/|\b[a-z0-9-]+\.(com|io|app|co|net|org)\b/i.test(text);
  if (dryRun) {
    console.log(JSON.stringify({ ok: true, dryRun: true, length, hasLink, postsToday: today, dailyCap: DAILY_CAP }));
    return;
  }
  const body = { text, ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}) };
  const { status, json } = await callX("POST", "/tweets", { body });
  const ok = status >= 200 && status < 300 && json?.data?.id;
  appendLog({ action: "post", ok: Boolean(ok), status, id: json?.data?.id, replyTo, hasLink, text });
  if (!ok) fail(`X rejected the post (HTTP ${status}): ${JSON.stringify(json).slice(0, 400)}`);
  console.log(JSON.stringify({ ok: true, id: json.data.id, url: `https://x.com/i/web/status/${json.data.id}`, postsToday: today + 1, dailyCap: DAILY_CAP }));
}

async function cmdDelete(args) {
  const id = args[0];
  if (!id || !/^\d+$/.test(id)) fail("Usage: delete <numeric post id>");
  const { status, json } = await callX("DELETE", `/tweets/${id}`);
  const ok = status >= 200 && status < 300 && json?.data?.deleted;
  appendLog({ action: "delete", ok: Boolean(ok), status, id });
  if (!ok) fail(`Delete failed (HTTP ${status}): ${JSON.stringify(json).slice(0, 400)}`);
  console.log(JSON.stringify({ ok: true, deleted: id }));
}

async function cmdWhoami() {
  const { status, json } = await callX("GET", "/users/me");
  if (status !== 200) fail(`Could not verify keys (HTTP ${status}): ${JSON.stringify(json).slice(0, 400)}`);
  console.log(JSON.stringify({ ok: true, username: json?.data?.username, name: json?.data?.name, id: json?.data?.id }));
}

function cmdLog(args) {
  const n = Math.max(1, Number.parseInt(args[0] || "10", 10) || 10);
  const entries = readLog().slice(-n);
  console.log(JSON.stringify({ postsToday: postsToday(), dailyCap: DAILY_CAP, entries }, null, 2));
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "post") return cmdPost(args);
  if (cmd === "delete") return cmdDelete(args);
  if (cmd === "whoami") return cmdWhoami();
  if (cmd === "log") return cmdLog(args);
  console.log('Usage: node x-post.mjs post [--dry-run] [--reply-to <id>] "text" | delete <id> | whoami | log [n]');
  process.exit(cmd ? 1 : 0);
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("x-post.mjs");
if (isMain) {
  main().catch((err) => fail(String(err?.stack || err)));
}
