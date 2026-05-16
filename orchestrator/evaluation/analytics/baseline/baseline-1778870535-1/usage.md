# Cost summary — baseline-1778870535-1

## Per-phase totals

| Phase | Wall ms | Autonomous ms | input | output | cache_create | cache_read |
| --- | --- | --- | --- | --- | --- | --- |
| spec | 154865 | 166854 | 46 | 7305 | 206049 | 496421 |
| design | 148310 | 152652 | 20 | 9734 | 30505 | 200478 |
| plan | 202842 | 215815 | 43 | 17018 | 120087 | 627913 |
| build | 951187 | 633207 | 118 | 33654 | 104815 | 6549340 |
| review | 272554 | 297029 | 88 | 15355 | 237402 | 4043714 |

## Per-phase orchestrator vs subagent split

| Phase | Orch wall | Orch autonomous | Sub wall | Sub autonomous |
| --- | --- | --- | --- | --- |
| spec | 0 | 0 | 154865 | 166854 |
| design | 0 | 0 | 148310 | 152652 |
| plan | 0 | 0 | 202842 | 215815 |
| build | 0 | 0 | 951187 | 633207 |
| review | 0 | 0 | 272554 | 297029 |

## Run totals

- Wall ms: 1729758
- Autonomous ms: 1465557
- Tokens: input=315, output=83066, cache_create=698858, cache_read=11917866

## Crashed invocations

_(none)_
