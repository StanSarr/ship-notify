import assert from "node:assert/strict";
import { test } from "node:test";
import { changelog, parseCommit } from "../src/commits.mjs";
import { COLORS, easUrl, formatMessages, withoutImages } from "../src/format.mjs";
import { projectOf } from "../src/projects.mjs";
import { post, readJson } from "../src/notify.mjs";

const base = {
  project: projectOf("deenpocket"),
  env: "staging",
  repo: "StanSarr/DeenPocket",
  commit: "abcdef1234567",
  branch: "staging",
  author: { login: "StanSarr" },
  runUrl: "https://github.com/StanSarr/DeenPocket/actions/runs/1",
  commits: [],
};
const blocksOf = (payload) => payload.attachments[0].blocks;
const textOf = (payload) => JSON.stringify(blocksOf(payload));

const build = (over) => ({
  id: "b-1",
  platform: "IOS",
  status: "FINISHED",
  appVersion: "2.1.0",
  appBuildVersion: "142",
  buildProfile: "staging",
  createdAt: "2026-10-07T10:00:00Z",
  completedAt: "2026-10-07T10:14:00Z",
  project: { slug: "deenpocket", ownerAccount: { name: "bmtech" } },
  ...over,
});

test("a build is one message per platform, titled the way a tester looks for it", () => {
  const messages = formatMessages({ ...base, kind: "build", status: "success", builds: [build(), build({ id: "b-2", platform: "ANDROID", appBuildVersion: "88", artifacts: { buildUrl: "https://x/app.apk" } })] });
  assert.equal(messages.length, 2);
  assert.match(textOf(messages[0]), /New build available · iOS · v2\.1\.0 \(142\) · staging/);
  assert.match(textOf(messages[0]), /profile staging · 14 min/);
  assert.equal(messages[0].attachments[0].color, COLORS.success);
  assert.match(textOf(messages[1]), /Android · v2\.1\.0 \(88\)/);
  assert.match(textOf(messages[1]), /"Download"/);
});

test("a failed build is red, says what broke and leads to the logs", () => {
  const [message] = formatMessages({ ...base, kind: "build", status: "failed", builds: [build({ status: "ERRORED", error: { message: "credentials missing" } })] });
  assert.equal(message.attachments[0].color, COLORS.failed);
  assert.match(textOf(message), /iOS build failed/);
  assert.match(textOf(message), /credentials missing/);
  assert.match(textOf(message), /"Open logs"/);
  assert.doesNotMatch(textOf(message), /"Install"/);
});

test("every message names who shipped, with their avatar, and shows the app icon", () => {
  const [message] = formatMessages({ ...base, kind: "deploy", status: "success", surface: "API", url: "https://api-staging.deenpocket.com" });
  const [who, head] = blocksOf(message);
  assert.equal(who.elements[0].image_url, "https://github.com/StanSarr.png?size=64");
  assert.match(who.elements[1].text, /\*StanSarr\* · DeenPocket/);
  assert.equal(head.accessory.image_url, "https://raw.githubusercontent.com/StanSarr/ship-notify/main/icons/deenpocket.png");
  assert.match(textOf(message), /API deployed · staging/);
});

test("an OTA with no matching build waits, in amber", () => {
  const [message] = formatMessages({ ...base, kind: "ota", status: "success", updates: [{ platform: "ios", group: "g-1", runtimeVersion: "abc", project: { slug: "deenpocket", ownerAccount: { name: "bmtech" } } }] });
  assert.equal(message.attachments[0].color, COLORS.pending);
  assert.match(textOf(message), /waiting for a matching app build/);
  assert.match(textOf(message), /updates\/g-1/);
});

test("a custom message carries its own words, items, picture and buttons", () => {
  const [message] = formatMessages({ ...base, kind: "custom", status: "success", title: "Plan ready · Le but de la création", items: ["Leçon 1", "Leçon 2"], image: { url: "https://cdn/x.jpg" }, buttons: [{ text: "Open in console", url: "https://admin/x", primary: true }] });
  assert.match(textOf(message), /Plan ready/);
  assert.match(textOf(message), /• Leçon 1/);
  assert.ok(blocksOf(message).some((b) => b.type === "image" && b.image_url === "https://cdn/x.jpg"));
  assert.match(textOf(message), /Open in console/);
});

test("without images, nothing Slack would have to fetch is left", () => {
  const [message] = formatMessages({ ...base, kind: "custom", title: "x", image: { url: "https://cdn/x.jpg" } });
  assert.doesNotMatch(JSON.stringify(withoutImages(message)), /image_url/);
});

test("commits are parsed as conventional commits and grouped, features first", () => {
  assert.deepEqual(parseCommit("feat(learn): tree view (#104)", "s1"), { type: "feat", scope: "learn", description: "tree view", pr: 104, sha: "s1", breaking: false });
  const text = changelog([parseCommit("chore: bump"), parseCommit("fix(web): menus (#106)"), parseCommit("feat(learn): tree (#104)")], "StanSarr/DeenPocket");
  assert.ok(text.indexOf("*New*") < text.indexOf("*Fixed*"));
  assert.match(text, /pull\/104\|#104/);
  assert.match(text, /and 1 more/);
});

test("EAS pages are built from what eas --json prints", () => {
  assert.equal(easUrl(build(), "build"), "https://expo.dev/accounts/bmtech/projects/deenpocket/builds/b-1");
  assert.equal(easUrl({ id: "x" }, "build"), undefined);
});

test("readJson takes inline JSON, a file, and JSON after a notice", () => {
  assert.deepEqual(readJson('[{"a":1}]'), [{ a: 1 }]);
  assert.deepEqual(readJson('Notice: something\n[{"a":2}]'), [{ a: 2 }]);
  assert.equal(readJson("not json"), undefined);
});

test("a message Slack refuses for a picture is sent again without pictures", async () => {
  const sent = [];
  const fetchImpl = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return sent.length === 1 ? { ok: false, text: async () => "invalid_blocks: downloading image failed" } : { ok: true, text: async () => "ok" };
  };
  const [message] = formatMessages({ ...base, kind: "custom", title: "x", image: { url: "https://cdn/x.jpg" } });
  const result = await post("https://hooks.slack.test", message, fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(sent.length, 2);
  assert.doesNotMatch(JSON.stringify(sent[1]), /image_url/);
});
