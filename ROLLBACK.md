# Rollback procedure

This covers getting `mast-master` back to a known-good state quickly if a
promotion to `master` breaks something. It does **not** touch `develop` —
that keeps changing independently.

## How "known good" points get created

Every time a commit lands on `master` (i.e. every time a PR from `develop`
gets merged), a GitHub Action automatically creates a tag named
`stable-YYYY-MM-DD-HHMM` pointing at that exact commit. You don't need to
do anything for this to happen — see `.github/workflows/tag-stable.yml`.

To see the available tags:
- GitHub → repo → **Tags** (or `github.com/B1acks1te/Ai-Summary/tags`), or
- `git tag -l "stable-*"` from a local clone, newest usually last

## Rolling back — the fast path

This does **not** touch git history. It just tells Portainer to build from
an older commit instead of the tip of `master`.

1. Pick the tag you want to roll back to (the most recent one *before* the bad change is usually right).
2. In Portainer → **Stacks** → **mast-master**.
3. Find **Repository reference** in the stack's settings.
4. Change it from `refs/heads/master` to `refs/tags/stable-2026-09-10-1425` (swap in the actual tag name you picked).
5. Click **Update the stack**. Portainer rebuilds from that exact historical commit.
6. Wait for the build to finish, then verify at `https://ai.bartletts.co.nz`.

## What this does and doesn't affect

- **MongoDB data is untouched.** The database lives in a separate,
  persistent Docker volume — rolling back application code never deletes
  or modifies stored data (outlooks, alerts, Gantt snapshots, etc.).
- **This only rolls back `mast-master`.** If `mast-dev` also needs rolling
  back, do the same thing on that stack, pointing at a `develop` commit or
  tag instead — though `mast-dev` doesn't get auto-tagged the same way,
  since it's expected to be in-progress. Use a specific commit SHA instead,
  e.g. `refs/heads/develop@<commit-sha>` (or just push a `git revert` to
  `develop` directly — that branch is meant to absorb this kind of churn).

## Resuming normal operation afterward

Once `develop` has a real fix and it's been promoted to `master` again
(new commit, new auto-tag created):

1. Go back to `mast-master`'s stack settings in Portainer.
2. Change **Repository reference** back to `refs/heads/master`.
3. **Update the stack.** This resumes normal webhook-triggered auto-deploy on every future push to `master` — while pinned to a specific tag, the webhook still fires but re-pulling the same fixed ref just re-confirms nothing changed, so nothing auto-updates until you switch it back.

## Quick reference

| Situation | Action |
|---|---|
| `master` broke, need it fixed *now* | Repoint `mast-master` to the last `stable-*` tag before the bad commit |
| Root cause fixed on `develop` | Promote via PR as normal → new tag auto-created |
| Ready to resume auto-deploy | Repoint `mast-master` back to `refs/heads/master` |
| Data got wiped/corrupted | This procedure won't help — that's a MongoDB backup/restore problem, not a code rollback |