# Cost summary — baseline-1779088265-1

## Per-phase totals

| Phase | Wall ms | Autonomous ms | input | output | cache_create | cache_read | errors | read-err | bash-fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| spec | 233255 | 264177 | 42 | 12495 | 77433 | 992255 | 1 | 1 | 0 |
| design | 145377 | 150521 | 20 | 9400 | 42315 | 167162 | 0 | 0 | 0 |
| plan | 338299 | 347796 | 33 | 21254 | 59717 | 831325 | 0 | 0 | 0 |
| build | 4197402 | 4507813 | 836 | 172931 | 1219290 | 32153370 | 10 | 3 | 2 |
| review | 316641 | 422511 | 71 | 17935 | 221406 | 2904422 | 0 | 0 | 0 |

## Per-phase orchestrator vs subagent split

| Phase | Orch wall | Orch autonomous | Sub wall | Sub autonomous |
| --- | --- | --- | --- | --- |
| spec | 0 | 0 | 233255 | 264177 |
| design | 0 | 0 | 145377 | 150521 |
| plan | 0 | 0 | 338299 | 347796 |
| build | 0 | 0 | 4197402 | 4507813 |
| review | 0 | 0 | 316641 | 422511 |

## Run totals

- Wall ms: 5230974
- Autonomous ms: 5692818
- Tokens: input=1002, output=234015, cache_create=1620161, cache_read=37048534

## Run outcome

_(outcome.json not present)_

## Crashed invocations

_(none)_
