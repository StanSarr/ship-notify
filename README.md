# ship-notify

One Slack message format for every ship — native builds, OTA updates, deploys
and pipeline steps — shared by DeenPocket, Kynel, Rinqo and Cutlyst.

Each message: a coloured bar for the outcome (green done, amber in progress or
waiting, red failed), who shipped with their GitHub avatar, the app's icon,
a title a tester can read at a glance ("New build available · iOS · v2.1.0 (142)
· staging"), what's included (features and fixes since the previous ship,
linked to their PRs), the error on a failure, an optional picture, and buttons.

## Use

```yaml
- uses: StanSarr/ship-notify@v1
  if: always()
  with:
    webhook: ${{ secrets.SLACK_WEBHOOK_BUILDS }}
    project: deenpocket
    kind: build                       # build | ota | deploy | custom
    status: ${{ job.status == 'success' && 'success' || 'failed' }}
    env: staging
    builds: /tmp/builds.json          # what `eas build --json` printed
    base-sha: ${{ github.event.before }}
```

| kind     | needs                                    | message                                                     |
| -------- | ---------------------------------------- | ----------------------------------------------------------- |
| `build`  | `builds` (eas build --json)              | one per platform: "New build available · iOS · v… · env"     |
| `ota`    | `updates` (eas update --json), `targets` | "OTA update published", amber when no build matches yet     |
| `deploy` | `surface`, `url`                         | "API deployed · staging"                                    |
| `custom` | `title`, `items`, `buttons`, `image-url` | anything else: a store promotion, a pipeline step           |

On a `workflow_run` (or a cron) `github.ref_name` is the default branch: pass `branch` (and `head-sha`) for the branch actually shipped.

`events-file` takes a JSON-lines file, one custom message per line, for a run
that has several things to say (each line can set `title`, `subtitle`, `items`,
`status`, `imageUrl`, `buttons`, …).

Without a `webhook` the message is printed; a refused message is a warning,
never a failed job (unless `fail-on-error: true`). A picture Slack cannot fetch
makes it reject the whole message, so a refused message is sent again without
pictures.

## Add a project

One entry in `src/projects.mjs` and its icon in `icons/<key>.png` (256×256).

## Develop

```
npm test
SN_PROJECT=deenpocket SN_KIND=deploy SN_SURFACE=API SN_ENV=staging node src/notify.mjs   # prints the payload
```
