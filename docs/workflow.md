# Branching & Deploy Workflow

```
feature branch ──PR──▶ dev ──PR──▶ main ──▶ production deploy
```

## Branches

| Branch | Role | Deploys? |
|--------|------|----------|
| `main` | **Production.** Only receives merges from `dev`. Protected: no direct pushes. | Yes — Render API + Vercel frontend deploy from `main`. |
| `dev` | **Integration.** Where work is reconciled and kept in sync. Feature branches merge here first. | No production deploy; Vercel gives a preview URL per push. |
| `feat/*`, `fix/*`, `chore/*` | Short-lived work branches, one per feature. | Preview deploys only (Vercel). |

## Rules

- Never push directly to `main` (branch protection blocks it anyway).
- Branch new work off `dev`, not `main`:
  `git checkout dev && git pull && git checkout -b feat/my-feature`
- Open PRs **into `dev`**. CI (typecheck, tests, build) gates every PR.
- Promote to production by opening a PR `dev → main` (release).
- Keep `dev` current with `main` after a release:
  `git checkout dev && git merge main` (or reset if histories are linear).

## CI behaviour

- Runs on every PR (any base) and on pushes to `main` and `dev`.
- Docs-only / non-code changes skip the heavy backend+frontend jobs but still
  report a green `CI` check, so required checks never block a docs PR.
- Path-aware deploys: Render only rebuilds when backend-relevant files change;
  Vercel only when `frontend/` changes (set via Vercel's Ignored Build Step).

## Day-to-day commands

```bash
# start work
git checkout dev && git pull
git checkout -b feat/thing

# ...commit regularly...

git push -u origin feat/thing
gh pr create --base dev --title "feat: thing"

# after the PR merges into dev, release
gh pr create --base main --head dev --title "release: <summary>"
```

## Deploy target configuration (must stay pinned)

- **Vercel** — Production Branch must remain `main` (Settings → Git). `dev`
  pushes then produce preview deployments only.
- **Render** — the web service's branch must remain `main`, with auto-deploy
  set to *after CI checks pass*, so `dev` merges never reach production.
