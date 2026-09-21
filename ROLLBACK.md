# Rollback guide

How to get **mast-master** back to a known-good release quickly if something
breaks after a promotion to `master`. It never touches `develop`.

> **All times below are New Zealand time.** Release tags are named in NZ time,
> so `stable-2026-09-21-1833` means **21 Sept 2026, 6:33 pm NZ**.

---

## Emergency card (start here)

**1. Find the last good release** (about 30 seconds)
GitHub → the repo → **Releases**. Newest is at the top, each with its NZ time
and the pull request it came from. Pick the release **before** the one that
broke things. (The broken release's page also lists a *Previous stable
release*.) The release page shows the exact text to paste in step 2.

**2. Point Portainer at it**
Portainer → **Stacks** → **mast-master** → set **Repository reference** to
`refs/tags/stable-YYYY-MM-DD-HHMM` (paste the one from the release) →
click **Pull and redeploy**.

**3. Wait for the rebuild** (a few minutes)
The current version keeps running while the new build is made, so the site is
only down for the few seconds it takes to swap containers.

**4. Check it worked**
- The site loads, and the Gantt page loads
- `https://ai.bartletts.co.nz/api/health` shows `"ok":true` (see *Health checks*)
- Alerts are showing on the dashboard

**5. Tell people** (one line to the team: "rolled back to the release from
[NZ time], looking into it").

**6. Get back to normal later.** Once a fix is merged to `master` (which
creates a new tag), set **Repository reference** back to `refs/heads/master`
and **Pull and redeploy**.
⚠️ **While pinned to a tag, merges to `master` do NOT deploy.** Don't forget
step 6.

---

## Roll back, or fix forward?

| Situation | Do this |
|---|---|
| Site down, error pages, or data clearly wrong for staff | **Roll back now**, investigate after |
| Small visual glitch, wording, or something with a workaround | Fix on `develop` and promote as normal |
| Only a new feature is broken and the rest works | Fix forward, unless it's blocking operational use |
| Not sure | Roll back. It's quick and reversible |

## How release points are created

Every commit that lands on `master` (every merged pull request from
`develop`) gets a tag automatically, from
`.github/workflows/tag-stable.yml`:

- **Name:** `stable-YYYY-MM-DD-HHMM` in NZ time. If two land in the same
  minute, seconds are added (`stable-2026-09-21-1833-07`).
- **Tag message:** the NZ time, the commit, the pull request title, and the
  previous stable tag.
- **A GitHub Release** is created for each tag: that's the "rollback menu".
  It has the NZ time, the pull request, the previous release, and the exact
  reference to paste into Portainer.
- **Optional Discord message.** Add a repo secret called
  `DEPLOY_DISCORD_WEBHOOK_URL` (GitHub → Settings → Secrets and variables →
  Actions) and each release also posts a line to that channel.

Tags are never moved or reused, so a stack pinned to a tag always rebuilds
the exact same code.

## What a rollback does and doesn't do

- ✅ **Rolls back the application code** (UI, main-services, scrape-services)
  to that release.
- ✅ **MongoDB data is untouched.** It lives in a separate persistent volume.
  Newer releases only *add* things (new collections, optional fields), so
  older code simply ignores them. Nothing is deleted.
- ❌ **Doesn't roll back Portainer environment variables.** They aren't in
  git. Keep a private copy of each stack's variables (Portainer → the stack →
  Environment variables → **Advanced mode** → copy) in your password manager.
  Never commit them to the repo.
- ❌ **Doesn't fix bad or lost data.** That's a backup and restore job (see
  *Backups*).
- ❌ **Doesn't touch `mast-dev`.** To roll dev back, either push a
  `git revert` to `develop`, or create a branch at the old commit
  (`git branch dev-rollback <sha>` then `git push origin dev-rollback`) and
  set **mast-dev**'s Repository reference to `refs/heads/dev-rollback`.

## Health checks: catching problems early

- **UI:** `GET /api/health` returns `200 {"ok":true,...}` when the UI is up
  and can reach main-services and MongoDB. It returns `503` with details
  (`backend` / `db` = `down`) when it can't.
- **Backend:** `GET /health` on main-services (port 3000) does the same for
  MongoDB.
- **Docker** uses these to mark the `main_services` and `ui` containers
  **healthy** or **unhealthy** (visible in Portainer → Containers).
- **Uptime monitoring (recommended):** in Checkmate add an HTTP monitor for
  `https://ai.bartletts.co.nz/api/health` (expect status 200, check every
  minute) and one for the dev site, with alerts to your Discord. A bad
  release then tells *you* within about a minute, before staff do.

## Before every release to master (5 minutes)

1. `https://ai-dev.bartletts.co.nz/api/health` is OK, and you've clicked
   through the dashboard and Gantt page on dev.
2. **The current release has a tag** (GitHub → Releases). That's what you'd
   roll back to.
3. **Take a TrueNAS snapshot** of the dataset holding the Docker volumes (see
   *Backups*). Two clicks, and a great safety net.
4. Master's stack environment variables are saved somewhere private.
5. Note the time. Merge the PR, watch the Portainer build finish, then check
   `/api/health` on master and the Releases page for the new tag.

## Backups (data, not code)

Code can be rebuilt from git. **The database can't**: it holds the alert
history/timeline, the Gantt snapshots and the feedback reports, none of which
can be re-scraped. Protect it separately:

- **TrueNAS snapshots (easiest):** Data Protection → **Periodic Snapshot
  Tasks** → add one for the dataset that holds your Docker volumes. Daily,
  keep 14 days. To find the dataset: Portainer → **Volumes** → the
  `mongodb_data` volume → note its Mountpoint path, then snapshot the dataset
  that contains that path.
- **A one-off dump before a risky release** (run on the TrueNAS host; adjust
  the container name, and the database name comes from your stack's
  `MONGODB_DB_NAME`):
  ```
  docker exec <STACK_NAME>-mongodb mongodump -u root -p '<mongo password>' --authenticationDatabase admin --db <MONGODB_DB_NAME> --archive --gzip > mast-$(date +%F-%H%M).archive.gz
  ```
- **Restoring** is a deliberate, separate job. Stop the stack first, restore,
  then start it. Don't do it in a hurry.

## Practice run (do this once)

Rehearse on **mast-dev** so the first time isn't a real incident:

1. Create a branch at an older commit and push it.
2. Set **mast-dev**'s Repository reference to that branch → **Pull and
   redeploy**. Time how long the rebuild takes and confirm the site works.
3. Set it back to `refs/heads/develop` → **Pull and redeploy**.

Write the timing here for next time: `______ minutes`.

## Quick reference

| I want to... | Do this |
|---|---|
| See the release points | GitHub → **Releases** (NZ times) |
| Roll master back | Portainer → **mast-master** → Repository reference → `refs/tags/stable-...` → **Pull and redeploy** |
| Resume normal deploys | Repository reference → `refs/heads/master` → **Pull and redeploy** |
| Check the site is healthy | `https://ai.bartletts.co.nz/api/health` |
| Data got wiped or corrupted | Not a code rollback. Restore from the TrueNAS snapshot or a dump |
