# Cost summary — baseline-1778919632-1

## Per-phase totals

| Phase | Wall ms | Autonomous ms | input | output | cache_create | cache_read |
| --- | --- | --- | --- | --- | --- | --- |
| spec | 305799 | 200208 | 92 | 21850 | 258469 | 1433130 |
| design | 187261 | 138721 | 33 | 10988 | 54899 | 830535 |
| plan | 270381 | 250699 | 33 | 17014 | 42170 | 823226 |
| build | 1239532 | 931997 | 178 | 43406 | 301746 | 11343724 |

## Per-phase orchestrator vs subagent split

| Phase | Orch wall | Orch autonomous | Sub wall | Sub autonomous |
| --- | --- | --- | --- | --- |
| spec | 130463 | 0 | 175336 | 200208 |
| design | 53469 | 0 | 133792 | 138721 |
| plan | 30288 | 0 | 240093 | 250699 |
| build | 53891 | 0 | 1185641 | 931997 |

## Run totals

- Wall ms: 2002973
- Autonomous ms: 1521625
- Tokens: input=336, output=93258, cache_create=657284, cache_read=14430615

## Crashed invocations

_(none)_
