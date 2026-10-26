# Working alone (scheduled runs)

David wants Claude to keep building CROP while he is away, using its judgement about what needs his approval. A scheduled task starts a fresh session every few hours with these instructions. Read `CLAUDE.md` and `docs/BACKLOG.md` first.

## Standing principle (David, 26 Oct)

Keep going. When an item is finished, look at what's left and start the next one without waiting to be asked. This applies to scheduled runs and to sessions with David alike. Stop only for the "Hold for David" list below. Collect questions for David or Steve in the backlog under "Questions for David and Steve" rather than stopping to ask. A run ends only when its time is up or every remaining item is held.

## Each run

1. `git fetch` and start from the latest `main`. List open pull requests (`gh api repos/Strattegee/crop/pulls`). If one is open from an earlier run, finish it first (fix CI, then merge) rather than starting something new.
2. Take the top unfinished item in `docs/BACKLOG.md` that isn't waiting on someone, and when it ships, take the next one (see the standing principle). Big items: do a coherent, shippable slice (for example, the data model and API with tests), and leave the rest of the item described in the backlog.
3. Build on a branch, with tests. Run `pnpm -r build && pnpm typecheck && pnpm test` (start Postgres with `service postgresql start` if needed). For UI changes, check the page renders (Playwright against a local stack) before shipping.
4. Open a pull request with a plain-English description, wait for CI, merge when green. Merging to `main` deploys to staging; wait for the "Deploy staging" run and check it succeeded.
5. Update `docs/BACKLOG.md` (tick, add discoveries) and `CLAUDE.md` (new conventions) in the same pull request.
6. Update the progress page: edit `docs/progress/build.py` (`prog` entries), run it, then publish `docs/progress/crop-progress.html` to https://claude.ai/artifact/T3ZwJkoUbNkDm4sKD1mW4b (read it first with the Artifact tool, then publish with that `url`).
7. Append a dated entry to `docs/RUNLOG.md` (what shipped, what's next, anything waiting on David), commit it with the work, and send David a short summary (2–6 lines, plain English, no jargon) as the run's final message.

## Ship without asking

Anything covered by the backlog that passes tests: new features, fixes, tests, docs, migrations that add tables or columns, UI improvements, staging deploys. Staging holds test data only.

## Hold for David (prepare it on a branch or as a note, don't merge or act)

- Product direction changes. (The Ribbon roster is cleared to build as of 26 Oct; questions from Steve's sessions go in `docs/decisions/`.)
- Anything that costs money, signs up to or changes an outside service, or changes DNS, Zitadel, DigitalOcean or GitHub settings.
- Contacting anyone outside (email, SMS to real people, app store submissions).
- Deleting or rewriting data, or migrations that drop or rename columns holding data.
- Production (none exists yet) and secrets. Never ask for or handle secret values; David stores them on the server with `read -s`.
- Security-sensitive changes to sign-in, permissions or row-level security beyond adding policies for new tables in the established pattern.

When something is held, say so in the run's summary and add it under "Waiting on David" in the backlog.

## Rules that always apply

- No real worker, patient or client data in code, fixtures or messages. Never put health information or document numbers in a notification.
- Don't use Entire OnHire's code or copy its screens; CROP is written from scratch.
- Australian English in the UI.
