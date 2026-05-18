# Cost summary — baseline-1779046840-1

## Per-phase totals

| Phase | Wall ms | Autonomous ms | input | output | cache_create | cache_read | errors | read-err | bash-fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| spec | 178292 | 194228 | 37 | 7773 | 72583 | 830983 | 1 | 0 | 0 |
| design | 138068 | 142276 | 20 | 8883 | 28785 | 185175 | 0 | 0 | 0 |
| plan | 2675293 | 1649704 | 260 | 69031 | 228301 | 18866746 | 0 | 0 | 0 |
| review | 305350 | 362058 | 79 | 15190 | 237276 | 3555563 | 1 | 1 | 0 |

## Per-phase orchestrator vs subagent split

| Phase | Orch wall | Orch autonomous | Sub wall | Sub autonomous |
| --- | --- | --- | --- | --- |
| spec | 0 | 0 | 178292 | 194228 |
| design | 0 | 0 | 138068 | 142276 |
| plan | 0 | 0 | 2675293 | 1649704 |
| review | 0 | 0 | 305350 | 362058 |

## Run totals

- Wall ms: 3297003
- Autonomous ms: 2348266
- Tokens: input=396, output=100877, cache_create=566945, cache_read=23438467

## Run outcome

_(outcome.json not present)_

## Crashed invocations

_(none)_
