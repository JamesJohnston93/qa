# Cin7 ↔ Manhattan SCALE — testing tools

Shared toolset for testing the Cin7 and Manhattan SCALE integrations. It lives outside the
codebase on purpose: testing tooling, not shipped code.

One folder per integration, plus `common/` for tools that serve all of them. Add to the
relevant folder rather than creating a scratch directory elsewhere — the point of this
directory is that there is one place to look.

| Folder | Integration | Start here |
| --- | --- | --- |
| `cin7-sales-orders/` | Cin7 sales orders → SCALE Shipments. Native ECOM orders and the outbound WHOLESALE/RTV family | [`cin7-sales-orders/README.md`](cin7-sales-orders/README.md) |
| `cin7-item-master/` | Cin7 item master → SCALE Items, and the older UNI `us`/`ps` catalog sync | [`cin7-item-master/README.md`](cin7-item-master/README.md) |
| `common/` | Tools that serve every integration here | [`common/README.md`](common/README.md) |

Working with an AI assistant? `CLAUDE.md` beside this file briefs it on the layout, the safety
rules and the known traps, so it doesn't have to read the whole directory first.

## Credentials

Cin7-facing tools read `CIN7_USERNAME` / `CIN7_API_KEY` from a `.env` **at this root**, which
every script finds regardless of the folder it sits in. Copy `.env.example` to `.env` and fill
it in.

**Cin7 is CTC's production system.** Every tool here is GET-only against it — nothing writes to
Cin7. Never commit or share a filled-in `.env`.

## AWS access

Tools take `--stage` and `--profile` and use your own AWS SSO session; none carry credentials of
their own. Anything that writes says so in its `--help`, and the destructive ones refuse to run
outside the stages they are scoped to.
