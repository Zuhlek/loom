# Cost summary — baseline-1778968525-1

## Per-phase totals

| Phase | Wall ms | Autonomous ms | input | output | cache_create | cache_read | errors | read-err | bash-fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| spec | 166192 | 186881 | 63 | 8005 | 162513 | 821854 | 0 | 0 | 0 |
| design | 137070 | 142201 | 33 | 9367 | 48118 | 107507 | 0 | 0 | 0 |
| plan | 241086 | 249463 | 35 | 16497 | 48332 | 846568 | 0 | 0 | 0 |
| build | 2425590 | 831558 | 170 | 46683 | 132524 | 11366376 | 1 | 0 | 1 |
| review | 376392 | 345222 | 77 | 14888 | 91408 | 3630007 | 0 | 0 | 0 |

## Per-phase orchestrator vs subagent split

| Phase | Orch wall | Orch autonomous | Sub wall | Sub autonomous |
| --- | --- | --- | --- | --- |
| spec | 0 | 0 | 166192 | 186881 |
| design | 0 | 0 | 137070 | 142201 |
| plan | 0 | 0 | 241086 | 249463 |
| build | 0 | 0 | 2425590 | 831558 |
| review | 0 | 0 | 376392 | 345222 |

## Run totals

- Wall ms: 3346330
- Autonomous ms: 1755325
- Tokens: input=378, output=95440, cache_create=482895, cache_read=16772312

## Run outcome

_(outcome.json not present)_

## Crashed invocations

_(none)_
