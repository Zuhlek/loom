# Cost summary — baseline-1779002783-1

## Per-phase totals

| Phase | Wall ms | Autonomous ms | input | output | cache_create | cache_read | errors | read-err | bash-fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| spec | 116201 | 122601 | 54 | 9050 | 147255 | 416530 | 0 | 0 | 0 |
| design | 122740 | 124910 | 32 | 8721 | 38498 | 94072 | 0 | 0 | 0 |
| plan | 260161 | 269153 | 42 | 15728 | 55035 | 1198112 | 0 | 0 | 0 |
| build | 1911937 | 742608 | 157 | 41103 | 178940 | 10047135 | 0 | 0 | 0 |
| review | 355263 | 475195 | 89 | 16689 | 268895 | 3601487 | 0 | 0 | 0 |

## Per-phase orchestrator vs subagent split

| Phase | Orch wall | Orch autonomous | Sub wall | Sub autonomous |
| --- | --- | --- | --- | --- |
| spec | 0 | 0 | 116201 | 122601 |
| design | 0 | 0 | 122740 | 124910 |
| plan | 0 | 0 | 260161 | 269153 |
| build | 0 | 0 | 1911937 | 742608 |
| review | 0 | 0 | 355263 | 475195 |

## Run totals

- Wall ms: 2766302
- Autonomous ms: 1734467
- Tokens: input=374, output=91291, cache_create=688623, cache_read=15357336

## Run outcome

_(outcome.json not present)_

## Crashed invocations

_(none)_
