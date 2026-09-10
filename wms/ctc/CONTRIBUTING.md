# Working in this folder

Two people: JJ (QA) and Jared. Small enough that process should stay light, but three rules are not optional.

## 1. Never commit a credential

`tools/.env` holds the Cin7 production API key and is gitignored. So is every other `.env`. Copy `tools/.env.example` and fill in your own; do not rename, move, or force-add the real one.

**Cin7 is CTC's production system.** Every script here is GET-only against it and must stay that way.

## 2. This folder holds company material

Universal Store QA documents, internal design references and product catalog data. The repo is private and is expected to stay private. Nothing here goes into a public gist, an issue on a public repo, or a screenshot in a public channel.

Customer data is a live concern rather than a theoretical one: `BUSY-1065-sales-orders/CTC-customer-data-in-cloudwatch.md` records that name, email and address are readable in CloudWatch on staging. **Redact before pasting any raw log output into a file here.**

## 3. Result files are evidence

A file under any `results/` folder records what was observed at the time. Correct a factual error, but do not tidy, reword or re-path one to match a later structure. Where an old result names a script by a path that has since moved, the mapping is in the relevant README.

## Where things are

`README.md` at this folder's root has the layout and the path rules. Read it before writing a path.

Start any piece of work from the task folder's `CLAUDE.md`, then `STATE.md`.

## Branches

`main` directly is fine for docs and results. Use a branch when changing something the other person is likely to be editing at the same time, which in practice means a QA doc mid-pass or a shared script in `tools/`.

Say in the commit message what actually changed, not that files were updated.
