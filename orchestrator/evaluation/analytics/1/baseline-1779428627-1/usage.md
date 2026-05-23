# Cost summary — baseline-1779428627-1

## Per-phase totals

| Phase | Wall ms | Autonomous ms | input | output | cache_create | cache_read | errors | read-err | bash-fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| spec | 554598 | 495480 | 209 | 12387 | 251374 | 2276535 | 0 | 0 | 0 |
| design | 347502 | 356135 | 21 | 10340 | 46443 | 172022 | 0 | 0 | 0 |
| plan | 444991 | 470477 | 43 | 13664 | 67080 | 1389954 | 1 | 0 | 0 |
| build | 1943098 | 1119471 | 164 | 45971 | 161593 | 12446837 | 0 | 0 | 0 |
| review | 273607 | 271059 | 71 | 11994 | 88329 | 3391793 | 0 | 0 | 0 |

## Per-phase orchestrator vs subagent split

| Phase | Orch wall | Orch autonomous | Sub wall | Sub autonomous |
| --- | --- | --- | --- | --- |
| spec | 0 | 0 | 554598 | 495480 |
| design | 0 | 0 | 347502 | 356135 |
| plan | 0 | 0 | 444991 | 470477 |
| build | 0 | 0 | 1943098 | 1119471 |
| review | 0 | 0 | 273607 | 271059 |

## Run totals

- Wall ms: 3563796
- Autonomous ms: 2712622
- Tokens: input=508, output=94356, cache_create=614819, cache_read=19677141

## Run outcome

_(outcome.json not present)_

## Crashed invocations

_(none)_
