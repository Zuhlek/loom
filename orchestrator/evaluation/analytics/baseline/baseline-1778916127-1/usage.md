# Cost summary — baseline-1778916127-1

## Per-phase totals

| Phase | Wall ms | Autonomous ms | input | output | cache_create | cache_read |
| --- | --- | --- | --- | --- | --- | --- |
| spec | 175225 | 206679 | 66 | 10108 | 216475 | 1192136 |
| design | 199750 | 215178 | 30 | 13431 | 58583 | 502785 |
| plan | 412960 | 434225 | 62 | 28143 | 107119 | 1641345 |
| build | 929566 | 1022048 | 259 | 72906 | 810187 | 21092897 |
| review | 334838 | 397271 | 112 | 20891 | 331734 | 6522896 |

## Per-phase orchestrator vs subagent split

| Phase | Orch wall | Orch autonomous | Sub wall | Sub autonomous |
| --- | --- | --- | --- | --- |
| spec | 0 | 0 | 175225 | 206679 |
| design | 0 | 0 | 199750 | 215178 |
| plan | 0 | 0 | 412960 | 434225 |
| build | 0 | 0 | 929566 | 1022048 |
| review | 0 | 0 | 334838 | 397271 |

## Run totals

- Wall ms: 2052339
- Autonomous ms: 2275401
- Tokens: input=529, output=145479, cache_create=1524098, cache_read=30952059

## Crashed invocations

_(none)_
