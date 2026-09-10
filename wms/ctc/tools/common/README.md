# Common tools

Tools that serve every Cin7/Manhattan integration in this directory rather than one of them.

| Tool | What it does | Writes? |
| --- | --- | --- |
| `cin7-watermark.sh` | Views or sets a Cin7 poller's watermark — the SSM parameter deciding which window of Cin7 records that poller re-reads next cycle. Cin7 test data cannot be created or edited directly, so this is the main test lever for any poller here. `--poller so\|po\|item` picks the flow; they are separate parameters and resetting one must never rewind another | **Yes** with `--set --confirm` — an SSM parameter |
| `probe-manhattan.sh` | POSTs a hand-written document straight to Manhattan SCALE and prints its reply. For answering "how does SCALE actually behave if we send X" without changing service code | **Yes** — sends to SCALE |

Pass `--poller` to `cin7-watermark.sh` every time. It has a default, and reading or resetting
the wrong flow's parameter is silent.
