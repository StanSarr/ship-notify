#!/usr/bin/env node
/**
 * Read the action's inputs (environment variables SN_*), gather what the
 * message needs (the commits since the previous ship, the EAS JSON), format
 * and post. A notification is a courtesy: whatever goes wrong here is logged
 * and the step still succeeds, unless SN_FAIL_ON_ERROR is "true".
 */
import { existsSync, readFileSync } from "node:fs";
import { fetchCommits, parseCommit } from "./commits.mjs";
import { formatMessages, withoutImages } from "./format.mjs";
import { projectOf } from "./projects.mjs";

const env = process.env;
const value = (name) => {
  const v = env[`SN_${name}`];
  return v === undefined || v === "" ? undefined : v;
};

/** A JSON input given inline or as a path to a file; undefined when absent or unreadable. */
export function readJson(raw) {
  if (!raw) return undefined;
  const text = existsSync(raw) ? readFileSync(raw, "utf8") : raw;
  try {
    return JSON.parse(text);
  } catch {
    // `eas --json` can print a notice before the JSON.
    const start = text.search(/[[{]/u);
    try {
      return start >= 0 ? JSON.parse(text.slice(start)) : undefined;
    } catch {
      return undefined;
    }
  }
}

const asArray = (data) => (Array.isArray(data) ? data : data ? [data] : []);

function readText(raw) {
  if (!raw) return undefined;
  const text = existsSync(raw) ? readFileSync(raw, "utf8") : raw;
  // The end of a log is where the error is.
  const lines = text.trim().split("\n");
  return lines.slice(-25).join("\n") || undefined;
}

/** Each line of a JSON-lines file is one more message (a pipeline step, for instance). */
function readEvents(raw) {
  if (!raw || !existsSync(raw)) return [];
  return readFileSync(raw, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export async function post(webhook, payload, fetchImpl = fetch) {
  const send = async (body) => {
    const response = await fetchImpl(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, text: await response.text() };
  };
  const first = await send(payload);
  if (first.ok) return first;
  // One picture Slack could not fetch rejects the whole message: say it without pictures.
  if (/image|invalid_blocks|downloading/iu.test(first.text)) return send(withoutImages(payload));
  return first;
}

async function main() {
  const webhook = value("WEBHOOK");
  const repo = value("REPO") ?? env.GITHUB_REPOSITORY;
  const head = value("HEAD_SHA") ?? env.GITHUB_SHA;
  const project = projectOf(value("PROJECT"), { name: value("PROJECT_NAME"), iconUrl: value("ICON_URL") });

  const given = readJson(value("COMMITS"));
  const commits = Array.isArray(given)
    ? given.map((c) => (typeof c === "string" ? parseCommit(c) : c))
    : await fetchCommits({ repo, base: value("BASE_SHA"), head, token: value("GITHUB_TOKEN") });

  const base = {
    kind: value("KIND") ?? "custom",
    status: value("STATUS") ?? "success",
    project,
    env: value("ENV"),
    repo,
    commit: head,
    branch: value("BRANCH") ?? env.GITHUB_REF_NAME,
    author: { login: value("AUTHOR") ?? env.GITHUB_ACTOR },
    runUrl:
      value("RUN_URL") ??
      (env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined),
    commits,
    title: value("TITLE"),
    subtitle: value("SUBTITLE"),
    body: value("BODY"),
    items: (value("ITEMS") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    platform: value("PLATFORM"),
    version: value("VERSION"),
    buildNumber: value("BUILD_NUMBER"),
    surface: value("SURFACE"),
    url: value("URL"),
    builds: asArray(readJson(value("BUILDS"))),
    updates: asArray(readJson(value("UPDATES"))),
    targets: asArray(readJson(value("TARGETS"))),
    error: value("ERROR") ?? readText(value("ERROR_FILE")),
    note: value("NOTE"),
    image: value("IMAGE_URL") ? { url: value("IMAGE_URL"), alt: value("IMAGE_ALT") } : undefined,
    buttons: asArray(readJson(value("BUTTONS"))),
  };

  const events = readEvents(value("EVENTS_FILE"));
  const inputs = events.length > 0 ? events.map((event) => ({ ...base, ...event, image: event.image ?? (event.imageUrl ? { url: event.imageUrl } : base.image) })) : [base];
  const payloads = inputs.flatMap(formatMessages);

  if (!webhook) {
    console.log("ship-notify: no webhook given, printing instead");
    console.log(JSON.stringify(payloads, null, 2));
    return;
  }
  for (const payload of payloads) {
    const result = await post(webhook, payload);
    if (!result.ok) throw new Error(`Slack refused the message: ${result.text}`);
  }
  console.log(`ship-notify: ${payloads.length} message(s) posted`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.log(`::warning::ship-notify: ${error instanceof Error ? error.message : String(error)}`);
    if (value("FAIL_ON_ERROR") === "true") process.exit(1);
  });
}
