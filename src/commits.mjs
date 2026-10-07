/**
 * What went out, as a reader of the channel wants it: the commits between the
 * previous ship and this one, parsed as conventional commits, features and
 * fixes first, the rest counted rather than listed.
 */

const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?:\s*(?<description>.+)$/u;
const PR_SUFFIX = /\s*\(#(\d+)\)\s*$/u;

/** One commit message's first line, as `{type, scope, description, pr, breaking}`. */
export function parseCommit(message, sha) {
  const first = String(message ?? "").split("\n")[0].trim();
  const pr = PR_SUFFIX.exec(first)?.[1];
  const subject = first.replace(PR_SUFFIX, "");
  const match = CONVENTIONAL.exec(subject);
  const breaking = Boolean(match?.groups?.breaking) || /BREAKING CHANGE/u.test(String(message ?? ""));
  return {
    type: match?.groups?.type ?? "other",
    scope: match?.groups?.scope,
    description: match?.groups?.description ?? subject,
    ...(pr ? { pr: Number(pr) } : {}),
    ...(sha ? { sha } : {}),
    breaking,
  };
}

/** Merge commits say nothing a reader needs: the commits they bring are listed themselves. */
function isMerge(message) {
  return /^Merge (pull request|branch|remote-tracking)/u.test(message) || /^merge:/u.test(message);
}

/**
 * The commits from `base` to `head`, from GitHub's compare API (so no deep
 * checkout is needed). Empty, never a failure: a changelog is a courtesy.
 */
export async function fetchCommits({ repo, base, head, token, fetchImpl = fetch }) {
  if (!repo || !head || !base || /^0+$/u.test(base) || base === head) return [];
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/compare/${base}...${head}`, {
      headers: {
        accept: "application/vnd.github+json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!response.ok) return [];
    const body = await response.json();
    return (body.commits ?? [])
      .filter((commit) => !isMerge(commit.commit?.message ?? ""))
      .map((commit) => parseCommit(commit.commit?.message, commit.sha));
  } catch {
    return [];
  }
}

const GROUPS = [
  { types: ["feat"], label: "New" },
  { types: ["fix"], label: "Fixed" },
  { types: ["perf"], label: "Faster" },
];
const MAX_LINES = 8;

/** Slack mrkdwn for "What's included", or null when there is nothing to say. */
export function changelog(commits, repo) {
  const list = (Array.isArray(commits) ? commits : []).filter(Boolean);
  if (list.length === 0) return null;
  const link = (commit) =>
    commit.pr
      ? ` <https://github.com/${repo}/pull/${commit.pr}|#${commit.pr}>`
      : commit.sha
        ? ` <https://github.com/${repo}/commit/${commit.sha}|${String(commit.sha).slice(0, 7)}>`
        : "";
  const line = (commit) =>
    `• ${commit.breaking ? "*breaking* " : ""}${commit.scope ? `*${commit.scope}* ` : ""}${commit.description}${link(commit)}`;

  const lines = [];
  let shown = 0;
  for (const group of GROUPS) {
    const picked = list.filter((commit) => group.types.includes(commit.type));
    if (picked.length === 0 || shown >= MAX_LINES) continue;
    lines.push(`*${group.label}*`);
    for (const commit of picked.slice(0, MAX_LINES - shown)) {
      lines.push(line(commit));
      shown += 1;
    }
  }
  const rest = list.length - shown;
  if (rest > 0) {
    lines.push(shown === 0 ? `_${rest} commit${rest > 1 ? "s" : ""}: maintenance, CI, dependencies_` : `_and ${rest} more_`);
  }
  return lines.join("\n").slice(0, 2900);
}
