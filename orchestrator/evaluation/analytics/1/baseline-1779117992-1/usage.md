# Cost summary — baseline-1779117992-1

## Per-phase totals

| Phase | Wall ms | Autonomous ms | input | output | cache_create | cache_read | errors | read-err | bash-fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| spec | 300212 | 215701 | 541 | 8324 | 134941 | 998216 | 0 | 0 | 0 |
| design | 163455 | 159216 | 22 | 8975 | 34102 | 225009 | 1 | 0 | 1 |
| plan | 410271 | 319749 | 36 | 14001 | 60639 | 899342 | 1 | 0 | 1 |
| build | 1580004 | 1820626 | 333 | 74283 | 556440 | 32927081 | 4 | 0 | 3 |
| review | 278671 | 308026 | 66 | 13104 | 117577 | 3287078 | 0 | 0 | 0 |

## Per-phase orchestrator vs subagent split

| Phase | Orch wall | Orch autonomous | Sub wall | Sub autonomous |
| --- | --- | --- | --- | --- |
| spec | 0 | 0 | 300212 | 215701 |
| design | 0 | 0 | 163455 | 159216 |
| plan | 0 | 0 | 410271 | 319749 |
| build | 0 | 0 | 1580004 | 1820626 |
| review | 0 | 0 | 278671 | 308026 |

## Run totals

- Wall ms: 2732613
- Autonomous ms: 2823318
- Tokens: input=998, output=118687, cache_create=903699, cache_read=38336726

## Run outcome

_(outcome.json not present)_

## Crashed invocations

_(none)_
