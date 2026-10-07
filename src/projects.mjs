/**
 * The apps that share these notifications: their display name, their icon
 * (served from this public repository, since Slack only shows images it can
 * fetch) and where their EAS builds live.
 *
 * Add a project: one entry here and `icons/<key>.png` (256×256).
 */
const ICON_BASE = "https://raw.githubusercontent.com/StanSarr/ship-notify/main/icons";

export const PROJECTS = {
  deenpocket: { name: "DeenPocket", expo: { account: "bmtech", slug: "deenpocket" } },
  kynel: { name: "Kynel", expo: { account: "bmtech", slug: "kynel" } },
  rinqo: { name: "Rinqo" },
  cutlyst: { name: "Cutlyst", expo: { account: "bmtech", slug: "cutlyst" } },
};

/** A project's name and icon; an unknown key still gets a readable name and no icon. */
export function projectOf(key, overrides = {}) {
  const known = PROJECTS[String(key ?? "").toLowerCase()];
  const name = overrides.name || known?.name || String(key || "App");
  const icon = overrides.iconUrl || (known ? `${ICON_BASE}/${String(key).toLowerCase()}.png` : undefined);
  const expo = overrides.expo || known?.expo;
  return { key: String(key ?? "").toLowerCase(), name, icon, expo };
}
