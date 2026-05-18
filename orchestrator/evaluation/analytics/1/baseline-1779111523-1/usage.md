# Cost summary — baseline-1779111523-1

## Per-phase totals

| Phase | Wall ms | Autonomous ms | input | output | cache_create | cache_read | errors | read-err | bash-fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| spec | 241071 | 278110 | 46 | 13886 | 87533 | 1209289 | 1 | 0 | 0 |
| design | 162572 | 167715 | 20 | 10198 | 32085 | 207036 | 0 | 0 | 0 |
| plan | 256023 | 277514 | 34 | 15261 | 57565 | 923896 | 0 | 0 | 0 |
| build | 1397642 | 936287 | 166 | 45314 | 146262 | 11355090 | 1 | 0 | 0 |
| review | 483214 | 377400 | 87 | 12824 | 216939 | 4282245 | 0 | 0 | 0 |

## Per-phase orchestrator vs subagent split

| Phase | Orch wall | Orch autonomous | Sub wall | Sub autonomous |
| --- | --- | --- | --- | --- |
| spec | 0 | 0 | 241071 | 278110 |
| design | 0 | 0 | 162572 | 167715 |
| plan | 0 | 0 | 256023 | 277514 |
| build | 0 | 0 | 1397642 | 936287 |
| review | 0 | 0 | 483214 | 377400 |

## Run totals

- Wall ms: 2540522
- Autonomous ms: 2037026
- Tokens: input=353, output=97483, cache_create=540384, cache_read=17977556

## Run outcome

_(outcome.json not present)_

## Crashed invocations

_(none)_
