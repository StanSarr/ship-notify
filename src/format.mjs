/**
 * One shipping event as Slack messages.
 *
 * Every message has the same shape, whatever the project:
 *
 *   ▌ (avatar) stansarr · DeenPocket                         ← who shipped, which app
 *   ▌ New build available · iOS · v2.1.0 (142) · staging     (app icon)
 *   ▌ profile staging · 14 min · fingerprint 21d6fa5
 *   ▌ What's included                                        ← features and fixes, linked to their PRs
 *   ▌ • learn — categories, themes and subthemes #104
 *   ▌ [error tail, on a failure]
 *   ▌ [picture, when there is one]
 *   ▌ [Install] [Open on EAS] [Workflow run]
 *   ▌ `abc1234` · staging · 18:17
 *
 * The coloured bar (a legacy attachment wrapping the blocks) is the outcome:
 * green done, amber in progress or waiting, red failed, grey skipped. A
 * native build is one message per platform, so a tester reads "iOS" or
 * "Android" in the title of the one they care about.
 *
 * Pure: everything it needs comes in `input`, nothing is fetched here.
 */
import { changelog } from "./commits.mjs";

export const COLORS = { success: "#1D9E75", failed: "#E24B4A", started: "#EF9F27", pending: "#EF9F27", skipped: "#888780" };
const PLATFORM = { ios: "iOS", android: "Android" };
const ENV = { staging: "staging", production: "production", preview: "preview", development: "development" };

const clip = (text, max) => (String(text).length <= max ? String(text) : `${String(text).slice(0, max - 1)}…`);
const short = (sha) => (sha ? String(sha).slice(0, 7) : "");
const envLabel = (env) => (env ? ENV[env] ?? env : "");
const join = (...parts) => parts.filter(Boolean).join(" · ");

function minutesBetween(start, end) {
  const from = Date.parse(start ?? "");
  const to = Date.parse(end ?? "");
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  const minutes = Math.round((to - from) / 60000);
  return minutes < 1 ? "under a minute" : `${minutes} min`;
}

/** The EAS page of a build or an update, from what `eas --json` prints. */
export function easUrl(item, kind, fallback) {
  const owner = item?.project?.ownerAccount?.name ?? fallback?.account;
  const slug = item?.project?.slug ?? fallback?.slug;
  const id = kind === "update" ? item?.group : item?.id;
  if (!owner || !slug || !id) return undefined;
  return `https://expo.dev/accounts/${owner}/projects/${slug}/${kind === "update" ? "updates" : "builds"}/${id}`;
}

function button(text, url, primary = false) {
  if (!url) return null;
  return {
    type: "button",
    text: { type: "plain_text", text: clip(text, 75), emoji: true },
    url,
    ...(primary ? { style: "primary" } : {}),
  };
}

function frame(input, { color, title, meta, details, image, buttons, fallback }) {
  const { project, author, commit, branch, env, runUrl, repo, error, note } = input;
  const blocks = [];

  const who = [
    author?.login ? { type: "image", image_url: `https://github.com/${author.login}.png?size=64`, alt_text: author.login } : null,
    { type: "mrkdwn", text: join(author?.login ? `*${author.login}*` : null, project.name) },
  ].filter(Boolean);
  blocks.push({ type: "context", elements: who });

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: [`*${clip(title, 280)}*`, meta ? clip(meta, 600) : null].filter(Boolean).join("\n") },
    ...(project.icon ? { accessory: { type: "image", image_url: project.icon, alt_text: project.name } } : {}),
  });

  for (const text of details.filter(Boolean)) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: clip(text, 2900) } });
  }
  if (error) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `\`\`\`${clip(String(error).trim(), 2800)}\`\`\`` } });
  }
  if (image?.url) {
    blocks.push({ type: "image", image_url: image.url, alt_text: clip(image.alt || title, 200) });
  }
  const actions = buttons.filter(Boolean).slice(0, 5);
  if (actions.length > 0) blocks.push({ type: "actions", elements: actions });
  if (note) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `_${clip(note, 2900)}_` }] });

  const footer = join(
    commit ? (repo ? `<https://github.com/${repo}/commit/${commit}|\`${short(commit)}\`>` : `\`${short(commit)}\``) : null,
    branch,
    runUrl ? `<${runUrl}|workflow run>` : null,
  );
  if (footer) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: footer }] });

  return { text: clip(fallback ?? `${project.name}: ${title}`, 300), attachments: [{ color, blocks }] };
}

function statusWord(status, done, verb) {
  return status === "success" ? done : status === "failed" ? `${verb} failed` : status === "skipped" ? `${verb} skipped` : `${verb} started`;
}

/** One message per platform: the tester looks for the platform they hold. */
function buildMessages(input) {
  const { status, env, builds = [], commits, repo, project } = input;
  const what = changelog(commits, repo);
  const list = builds.length > 0 ? builds : [{ platform: input.platform }];
  return list.map((build) => {
    const platform = PLATFORM[String(build.platform ?? "").toLowerCase()] ?? build.platform ?? "";
    const state = String(build.status ?? "").toUpperCase();
    const outcome = state === "FINISHED" ? "success" : state === "ERRORED" || state === "CANCELED" ? "failed" : status;
    const version = build.appVersion ?? input.version;
    const number = build.appBuildVersion ?? input.buildNumber;
    const release = version ? `v${version}${number ? ` (${number})` : ""}` : null;
    const title =
      outcome === "success"
        ? join("New build available", platform, release, envLabel(env))
        : join(`${platform ? `${platform} build` : "Build"} ${outcome === "failed" ? "failed" : outcome === "skipped" ? "skipped" : "started"}`, release, envLabel(env));
    const page = easUrl(build, "build", project.expo);
    const install = build.artifacts?.buildUrl;
    return frame(
      { ...input, error: build.error?.message ?? (outcome === "failed" ? input.error : undefined) },
      {
        color: COLORS[outcome] ?? COLORS.started,
        title,
        meta: join(
          build.buildProfile ? `profile ${build.buildProfile}` : null,
          minutesBetween(build.createdAt, build.completedAt),
          build.distribution,
          input.subtitle,
        ),
        details: [outcome !== "failed" && what ? `*What's included*\n${what}` : null],
        image: input.image,
        buttons: [
          outcome === "success" ? button("Install", page ?? install, true) : null,
          button("Open on EAS", page),
          install && page ? button("Download", install) : null,
          button(outcome === "failed" ? "Open logs" : "Workflow run", input.runUrl, outcome === "failed"),
        ],
      },
    );
  });
}

function otaMessage(input) {
  const { status, env, updates = [], targets = [], commits, repo, project } = input;
  const update = updates[0];
  const platforms = [...new Set(updates.map((u) => PLATFORM[String(u.platform).toLowerCase()] ?? u.platform))].join(" + ");
  const reaches = targets
    .map((build) => build.appBuildVersion)
    .filter(Boolean)
    .map((number) => `build ${number}`)
    .join(", ");
  const waiting = status === "success" && updates.length > 0 && targets.length === 0;
  const title =
    status === "success"
      ? join("OTA update published", envLabel(env), waiting ? "waiting for a matching app build" : null)
      : join(`OTA update ${status === "failed" ? "failed" : status}`, envLabel(env));
  const what = changelog(commits, repo);
  return frame(input, {
    color: waiting ? COLORS.pending : COLORS[status] ?? COLORS.started,
    title,
    meta: join(
      platforms || null,
      update?.runtimeVersion ? `runtime ${clip(update.runtimeVersion, 24)}` : null,
      reaches ? `reaches ${reaches}` : null,
      input.subtitle,
    ),
    details: [what ? `*What's included*\n${what}` : null],
    image: input.image,
    buttons: [
      button("Open update", easUrl(update, "update", project.expo), status === "success"),
      button(status === "failed" ? "Open logs" : "Workflow run", input.runUrl, status === "failed"),
    ],
  });
}

function deployMessage(input) {
  const { status, env, surface, url, commits, repo } = input;
  const what = changelog(commits, repo);
  const name = surface || "Deploy";
  return frame(input, {
    color: COLORS[status] ?? COLORS.started,
    title: join(statusWord(status, `${name} deployed`, name), envLabel(env)),
    meta: join(url ? `<${url}|${url.replace(/^https?:\/\//u, "")}>` : null, input.version ? `v${input.version}` : null, input.subtitle),
    details: [status !== "failed" && what ? `*What's included*\n${what}` : null],
    image: input.image,
    buttons: [
      status === "success" ? button("Open", url, true) : null,
      button(status === "failed" ? "Open logs" : "Workflow run", input.runUrl, status === "failed"),
    ],
  });
}

/** Anything else — a store promotion, a pipeline step: the caller writes the words. */
function customMessage(input) {
  const { status, items = [] } = input;
  return frame(input, {
    color: COLORS[status] ?? COLORS.started,
    title: input.title || statusWord(status, "Done", input.kind || "Job"),
    meta: input.subtitle,
    details: [items.length > 0 ? items.map((item) => `• ${item}`).join("\n") : null, input.body],
    image: input.image,
    buttons: [
      ...(input.buttons ?? []).map((b) => button(b.text, b.url, Boolean(b.primary))),
      input.buttons?.length ? null : button(status === "failed" ? "Open logs" : "Workflow run", input.runUrl, status === "failed"),
    ],
  });
}

/** The Slack payloads for one event (several for a multi-platform build). */
export function formatMessages(input) {
  switch (input.kind) {
    case "build":
      return buildMessages(input);
    case "ota":
      return [otaMessage(input)];
    case "deploy":
      return [deployMessage(input)];
    default:
      return [customMessage(input)];
  }
}

/** The same payload without any picture: Slack refuses a whole message over one image it cannot fetch. */
export function withoutImages(payload) {
  return {
    ...payload,
    attachments: payload.attachments.map((attachment) => ({
      ...attachment,
      blocks: attachment.blocks
        .filter((block) => block.type !== "image")
        .map((block) => {
          if (block.type === "section" && block.accessory?.type === "image") {
            const { accessory: _accessory, ...rest } = block;
            return rest;
          }
          if (block.type === "context") return { ...block, elements: block.elements.filter((element) => element.type !== "image") };
          return block;
        }),
    })),
  };
}
