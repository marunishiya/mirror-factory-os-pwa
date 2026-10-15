# PROJECT MIRROR — Repository Agent Operating Rules

These rules apply to coding agents working on MIRROR FACTORY OS PWA and MIRROR SOCIAL ENGINE.

## Authority and scope
- The existing `main` branch is production-adjacent and is protected by policy. **Never edit, force-push, or merge directly to main**.
- Current Worker v0.5 work lives in `chappy/mirror-worker-v05-20261016` (Draft PR #2). Begin new security work at its latest commit, in a **new isolated branch**. Do not reset or overwrite existing branches.
- The primary task specification is https://github.com/marunishiya/mirror-factory-os-pwa/issues/3. Check it and `docs/MIRROR_WORKER_V05_STATUS.md` first.
- Protect `index.html`, `social.html`, `social-v04.html`, `social-v05.html`, GitHub Pages deployment, browser-local saved data, non-public story content, master/canon images, and backups. Do not modify these except under an explicit separate task.

## Safety boundaries
- **NEVER** run production `wrangler deploy`, D1 migration/execution against remote DB, production Cron configuration, SNS posting, OAuth setup, fee-bearing APIs, or secrets creation/inspection. Running Wrangler with `--dry-run` is allowed.
- A test harness may use local SQLite, Miniflare or Wrangler local D1 with disposable fixtures, never remote production credentials.
- Do not expose personal information, tokens, credentials, unpublished assets or private authoring files in a public repo or logs.
- Do not declare SNS channels connected or postable unless official API credentials and actual verified implementation exist. This repo currently supports DRY-RUN planning only.

## Standard execution workflow
1. Inspect `git status`, branch base, repository files, existing tests, and outstanding issues before editing.
2. Implement one bounded security/reliability improvement and add failure-path regression tests.
3. Run `npm --prefix cloudflare-worker test` and `python3 cloudflare-worker/test/sqlite_atomic.py`.
4. Run or review the PR-only GitHub Actions workflow `.github/workflows/mirror-worker-verify.yml`, which executes tests and two Wrangler `--dry-run` builds.
5. Clearly separate verified results from unverified expectations, including remote D1 schema and Cron settings.
6. Push only the new development branch and open a **Draft PR** against the existing Worker development branch. Never merge.
7. Continue until the scoped issue's verifiable acceptance criteria are met or an external approval/credential is needed. If blocked, report precisely what is needed, and stop only the blocked step.
8. Write final handoff in Japanese: changes, CI URL, PASS/FAIL counts, remaining risks, next review action.

## Definition of done
- New tests pass and all existing tests are preserved.
- Local D1 compatibility where possible; mock SQLite checks alone are not proof of remote D1 schema correctness.
- Code and docs agree, and no publication/deployment happened.
- Reviewer can inspect the Draft PR and make an informed decision.
