---
name: masar-deploy
description: Verify, deploy and sync Masar changes on the Masar production server through git and AWS SSM. Use when Masar changes must be built, checked, put on the server for evaluation, committed, merged, reverted, or when the user asks whether everything is clean.
---

# Masar: verify locally, deploy through git, sync

This repository is **public**. The server's instance ID, host, bench path, site name and Linux user are
not written here: take them from the private Akwad skills `akwad-environment` and `akwad-deploy`
(placeholders below: `<instance>`, `<site>`, `<bench>`, `<bench user>`). Never commit them.

## Production rules

- The only Masar server is **production**, a bench shared with other apps and client sites. There is no
  dev/test site: changes are evaluated on production (client decision 2026-11-09), so backend tests and
  E2E specs cannot run. Say so in reports and commit messages.
- Access is AWS SSM (skill `akwad-aws-ssm`, since 2026-11-09). SSM cannot stream files, so **code reaches
  the server only through git**: the app checkout `<bench>/apps/masar` (remote `upstream` =
  github.com/akwadqa/masar) fetches a pushed commit and checks it out. Never build, clone, try things out
  or leave files on the server.
- `sites/assets/masar` links to the app's `masar/public`, so a checked-out Workspace build is live at once.
- Gunicorn runs with `--preload`: Python changes need a restart of the bench web and worker processes (as
  root). **Never restart Redis.**
- Allowed without asking: read-only inspection and counts, checking out pushed commits, restarting web
  and workers. DocType JSON changes: `bench --site <site> reload-doctype "<DocType>"` only, after asking
  each time; **never a full `bench migrate`** (shared bench, other apps' patches).
- Needs the approver's explicit OK, stating what changes and how many records: any write to site data
  (patches, cleanups, backfills, deletions, role assignments, tests, fixtures, `allow_tests`).
- **No SSM access in this session** (for example Claude Code on the web, which has no `aws-vault`)? Do
  everything up to the push, then stop and tell the approver exactly which commit to check out and
  whether a restart is needed.

## 0. Before implementing

- **Big or minor?** Big = new feature, several areas, API contract or permission changes, DocType/schema
  changes or patches, migrations, architecture: `feat/<name>` from an up-to-date `master`, PR, the
  approver merges. Minor = small fix, tweak, copy or style: `fix/<name>`, fast-forwarded into `master`
  after approval (no PR). Unsure: big.
- Affects other features (behaviour, URLs, permissions, shared components, API contracts, existing data)?
  List the impact and wait for the go-ahead.
- Small UI requests ("another button", "another filter"): add it in the existing pattern first; offer a
  redesign only as an option (the approver reverted a three-way control on 2026-11-02 and asked to "just
  add another button").
- Avoid stacked branches: start from `master` after earlier PRs are merged.

## 1. Verify locally

Use an LF worktree (`core.autocrlf=false`) and Node 24.

```bash
ruff check <changed .py> && ruff format --check <changed .py>
cd frontend && npm ci && npm run typecheck && npx vitest run && npm run build:app && npm run check:app
```

- Existing ruff findings: compare with `git show master:<file> | ruff check --stdin-filename <file> -` and
  fix only what the change introduced.
- Run `build:app` whenever frontend sources changed and commit the regenerated build with the change.
- **Backend changes cannot be tested anywhere.** Ruff only proves syntax and names, so read every changed
  code path against its callers, write or update the backend tests anyway, and import the changed modules
  on the server after deploying (2.3).
- **Notification and e-mail recipients:** a Task's owner stays after leaving the Space, so any recipient
  list built from owner or assignees must be intersected with the current Space members, or e-mail leaks
  Task titles to former members (caught before a deploy on 2026-11-02).
- **UI bugs are reproduced before they are fixed**, never with production data: run `npx nuxt dev`, then a
  throwaway Playwright script that answers `/api/**` through `page.route` (boot with `realtime: false`;
  `tasks.my_work` returns `{items, nextCursor}`, `batches.list` returns `{items, permissions}`, unknown
  methods `[]`). Add temporary `console.log('[repro] ...')` lines and read them with `page.on('console')`.
  Keep the script and the logs out of the commit.
- Multi-line scripted edits: write the script to a file and run it, then grep the result. Inline
  `node -e` and heredocs inside quoted shell strings have silently dropped text.

## 2. Deploy for evaluation

1. Commit on the branch (one logical change per commit, Conventional Commits, no AI attribution) and
   push it: `git push -u origin <branch>`. Unapproved work never lands on `master`.
2. Write the remote script to a local scratch file and run it through `ssm-run.sh` (skill
   `akwad-aws-ssm`) as `<bench user>`. Keep output short: SSM truncates at about 24,000 characters.
   ```bash
   cd <bench>/apps/masar
   test -z "$(git status --porcelain --untracked-files=no)" || { git status --short | head; exit 1; }
   OLD=$(git rev-parse HEAD)
   git fetch -q --prune upstream <branch> && git checkout -q --detach FETCH_HEAD
   echo "from $OLD to $(git rev-parse HEAD)"; git diff --name-only $OLD HEAD | grep -c .
   git diff --name-only $OLD HEAD -- '*.py' '*.json' | grep -v '^masar/public/' | head -30
   ```
3. **Python changed:** restart web and workers as root (`supervisorctl restart <bench>-web:
   <bench>-workers:`), never Redis. Health-check `/api/method/ping` with `Host: <site>` on
   `127.0.0.1:8000` and read the last lines of `logs/web.error.log`. Then, as `<bench user>`, import the
   changed modules read-only: `cd <bench>/sites && ../env/bin/python -c "import masar.services.<module>"`.
4. **DocType JSON changed:** `reload-doctype` only after explicit approval (Production rules).
5. **Prove it:** the server's `git rev-parse HEAD` equals the pushed commit and
   `git status --porcelain` is empty (ignored runtime files such as `__pycache__` do not count).
6. Report what changed, what was verified and what could not run. Wait for approval or "revert".

## 3. Evaluation rounds

The approver tests on production and sends short feedback ("avatar too big", "align it left"). Fix each
round as **one verified commit on the same branch**, push, check it out again, show a local screenshot
where possible, and list what still waits for approval. Approvals often cover several items at once.

### A fix found while a feature is under evaluation

The server must show all unapproved work, but builds of different branches conflict.

1. The fix gets its own `fix/<name>` branch from `origin/master` (sources and build), pushed.
2. The same source files go onto the feature branch as a separate commit with the same message
   (`git checkout fix/<name> -- <source files>`), then rebuild there, commit the build and deploy that.
3. On approval, fixes first. For each, on `master`: `git checkout <fix commit> -- <source files>`,
   rebuild, commit with the fix's message (`git log -1 --format=%B <commit> | git commit -F -`), push
   `master`, delete the fix branch on GitHub and locally (`-D`, because the commit differs).
4. Then `git merge origin/master` into the feature branch (never rebase or force-push a pushed branch).
   Resolve the build conflicts with `git checkout --theirs -- masar/public/frontend masar/www`, then
   `build:app` and `check:app`, `git add`, commit the merge, push, open the PR.

## 4. On approval

- **Big:** before the PR, `git diff --stat origin/master <branch> -- . ':!masar/public/frontend'
  ':!masar/www'` lists only this feature. `gh pr create --base master` (why, what changed, how verified,
  what could not run, release requirements). The approver merges, or says "merge PR <n>":
  `gh pr merge <n> --merge`. Then `git switch master && git pull --ff-only`.
- **Minor:** `git switch master && git merge --ff-only <branch> && git push origin master`.
- Sync the server to `master` (tree must be clean; restart only if Python differs from the evaluated
  commit):
  ```bash
  cd <bench>/apps/masar && git fetch -q --prune upstream
  git diff --name-only HEAD upstream/master -- '*.py' | head
  git checkout -q master 2>/dev/null || git checkout -q -b master upstream/master
  git reset -q --hard upstream/master && git status -sb | head -1
  ```
- Delete the merged branch on GitHub and locally, only when its content is on `master`; remove its
  worktree if one exists. Report unmerged branches instead of deleting them.

## 5. Cleanup audit (after a merge, or "is everything clean?")

- Local: `git status --short --untracked-files=all`, `git stash list`, `git worktree list`,
  `git branch -a` after `git fetch --prune`; leftover worktree folders next to the repo. On Windows, Nuxt
  leaves a `frontend/dist` junction: remove it with `cmd /c rmdir`, never recursively.
- GitHub: only `master` (`git branch -r`) and no open PRs (`gh pr list`).
- Server (as `<bench user>`): `HEAD` = `master` = GitHub; `git status --porcelain --untracked-files=all`
  empty; `git status --ignored --porcelain | grep -v __pycache__` empty; no extra branches or stashes;
  stale remote-tracking refs pruned; nothing named masar, patch, tar, zip or clone in `~` or `/tmp`.

## On "revert"

Server: check out the previous commit again (`git checkout -q --detach <OLD>`, or `master`) and restart
as in 2.3 if Python changed. Locally: drop or revert the branch commits.
