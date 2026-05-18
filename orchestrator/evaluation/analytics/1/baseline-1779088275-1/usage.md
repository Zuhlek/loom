# Cost summary — baseline-1779088275-1

## Per-phase totals

| Phase | Wall ms | Autonomous ms | input | output | cache_create | cache_read | errors | read-err | bash-fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| spec | 285882 | 341641 | 62 | 18427 | 92939 | 2023253 | 2 | 0 | 2 |
| design | 167713 | 173278 | 20 | 670 | 31708 | 195140 | 0 | 0 | 0 |
| plan | 294692 | 323733 | 42 | 19719 | 66697 | 1349162 | 0 | 0 | 0 |
| build | 2752170 | 3377423 | 6149 | 157597 | 1407399 | 31502061 | 7 | 5 | 1 |
| review | 361758 | 448306 | 21598 | 20336 | 236009 | 5254051 | 1 | 0 | 1 |

## Per-phase orchestrator vs subagent split

| Phase | Orch wall | Orch autonomous | Sub wall | Sub autonomous |
| --- | --- | --- | --- | --- |
| spec | 0 | 0 | 285882 | 341641 |
| design | 0 | 0 | 167713 | 173278 |
| plan | 0 | 0 | 294692 | 323733 |
| build | 0 | 0 | 2752170 | 3377423 |
| review | 0 | 0 | 361758 | 448306 |

## Run totals

- Wall ms: 3862215
- Autonomous ms: 4664381
- Tokens: input=27871, output=216749, cache_create=1834752, cache_read=40323667

## Run outcome

_(outcome.json not present)_

## Crashed invocations

_(none)_
