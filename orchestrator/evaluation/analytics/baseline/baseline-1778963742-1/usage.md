# Cost summary — baseline-1778963742-1

## Per-phase totals

| Phase | Wall ms | Autonomous ms | input | output | cache_create | cache_read | errors | read-err | bash-fail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| spec | 232464 | 279259 | 41 | 8054 | 83071 | 1075674 | 0 | 0 | 0 |
| design | 173563 | 177513 | 34 | 11248 | 42278 | 153938 | 0 | 0 | 0 |
| plan | 195949 | 197618 | 42 | 14750 | 58319 | 471694 | 0 | 0 | 0 |
| build | 2246529 | 1626302 | 170 | 32324 | 405286 | 8742067 | 1 | 0 | 1 |
| review | 321039 | 315272 | 79 | 14560 | 305422 | 2767120 | 0 | 0 | 0 |

## Per-phase orchestrator vs subagent split

| Phase | Orch wall | Orch autonomous | Sub wall | Sub autonomous |
| --- | --- | --- | --- | --- |
| spec | 0 | 0 | 232464 | 279259 |
| design | 0 | 0 | 173563 | 177513 |
| plan | 0 | 0 | 195949 | 197618 |
| build | 0 | 0 | 2246529 | 1626302 |
| review | 0 | 0 | 321039 | 315272 |

## Run totals

- Wall ms: 3169544
- Autonomous ms: 2595964
- Tokens: input=366, output=80936, cache_create=894376, cache_read=13210493

## Run outcome

- Lifecycle state: complete
- Final phase: review
- review.md present: True
- pipeline.md present: True

## Crashed invocations

_(none)_
