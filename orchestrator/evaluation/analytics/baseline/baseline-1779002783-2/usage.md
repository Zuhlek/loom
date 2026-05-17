# Cost summary — baseline-1779002783-2

## Per-phase totals

| Phase | Wall ms | Autonomous ms | input | output | cache_create | cache_read | errors | read-err | bash-fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| spec | 169510 | 199085 | 63 | 9890 | 235490 | 1201109 | 0 | 0 | 0 |
| design | 182383 | 192147 | 59 | 12374 | 76907 | 439874 | 0 | 0 | 0 |
| plan | 329778 | 347293 | 52 | 15775 | 69113 | 1600713 | 0 | 0 | 0 |
| build | 3400215 | 2114916 | 283 | 75106 | 557615 | 25838567 | 1 | 1 | 0 |
| review | 378908 | 543296 | 99 | 19648 | 323978 | 5611452 | 0 | 0 | 0 |

## Per-phase orchestrator vs subagent split

| Phase | Orch wall | Orch autonomous | Sub wall | Sub autonomous |
| --- | --- | --- | --- | --- |
| spec | 0 | 0 | 169510 | 199085 |
| design | 0 | 0 | 182383 | 192147 |
| plan | 0 | 0 | 329778 | 347293 |
| build | 0 | 0 | 3400215 | 2114916 |
| review | 0 | 0 | 378908 | 543296 |

## Run totals

- Wall ms: 4460794
- Autonomous ms: 3396737
- Tokens: input=556, output=132793, cache_create=1263103, cache_read=34691715

## Run outcome

_(outcome.json not present)_

## Crashed invocations

_(none)_
