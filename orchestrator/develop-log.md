
## 2026-05-28 — aper-pnpm-migration / build / T-008
- publish-packages.sh: npm version/publish → pnpm version --ignore-scripts / pnpm publish --no-git-checks (ADR-06). bash -n + grep gates pass.
- HITL-blocked on actual Verdaccio publish (operator-driven manual CI trigger).

## 2026-05-28 — aper-pnpm-migration / build / T-009
- publish-docker.sh: no direct npm/pnpm calls; common.sh::buildDocker already done by T-006.
- Audit found 9 Dockerfiles using `RUN npm install`; all 9 swapped to `pnpm install --prod` (NOT `--frozen-lockfile` per task — Dockerfile installs from unpacked tarball with no lockfile).
- Out-of-scope-edit: 9 aper-*/docker/*.dockerfile (per P-MIN-02 audit pattern).
- HITL-blocked on actual Docker push (operator-driven).

## 2026-05-28 — aper-pnpm-migration / build / T-010
- scripts/update-dependencies.sh: `npm run compile-all` → `pnpm run compile-all` (ADR-07).
- scripts/compile-all.sh: audited, no wrapper-layer npm/pnpm calls — unchanged.
- scripts/clean-install.sh: new file mirroring crs-sgkb (rm -rf node_modules + pnpm install --frozen-lockfile).

## 2026-05-28 — aper-pnpm-migration / build / T-011
- Deleted 6 (not 7; aper-reporting-workflow never had one) per-pkg package-lock.json files (working-tree only — were gitignored).
- .gitignore: dropped `package-lock.json` rule; preserved `**/bmpi-scripts/`.
- pnpm-lock.yaml tracking AC degraded (no Verdaccio → no install → no lockfile yet); deferred to T-012/CI.

## 2026-05-28 — aper-pnpm-migration / build / T-012
- Smoke gate BLOCKED — Verdaccio creds + postgres absent in Build session.
- 10/12 state assertions PASS statically (npm calls eliminated, structural blocks present, 7-pkg list correct, etc); 2 require Verdaccio (lockfile mint, tarball production).
- Caveat: pnpm install --no-frozen-lockfile probe relocated some aper-reporting/node_modules entries to .ignored before failing at registry fetch; mitigate via clean-install.sh once Verdaccio is reachable.

## 2026-05-28 — aper-pnpm-migration / build / phase
- Phase status: blocked (smoke gate needs Verdaccio+postgres).
- 10 AFK tasks reached Review (T-001..T-007, T-010, T-011) with degraded runtime ACs; smoke-report.md surfaces env block per dispatch step-2 rules.
- T-005 (Jest type verification), T-006/T-012 (runtime build/smoke), T-011 (lockfile mint) all carry "deferred to T-012 / CI" notes; T-012 itself is HITL-blocked on env.
- 2 HITL tasks (T-008, T-009) edits applied; operator-driven CI publish/push remains.

## 2026-05-28 — aper-pnpm-migration / review / phase
- Verdict: PASS — 0 blockers, 0 major, 5 minor, 3 notes. Accepted risk: runtime smoke gate deferred to CI.
- All 6 US-NNN stories satisfied structurally; all 8 ADRs honoured by diff; no commits made by Build (HEAD still 652f55b).
- Minors: (1) `.gitignore` `.forge` rule landed unrecorded in T-011 done; (2) `pnpm-lock.yaml` not yet minted — must be first action on next Build dispatch with creds; (3) pre-existing `@azure/*` dep+devDep dupe in aper-reporting preserved as out-of-scope; (4) pre-existing `aper-reporting-workflow → aper-data-reports` script-arg typo preserved; (5) only 6 (not 7) `package-lock.json` existed — T-011 silently absorbed.
- Notes: principles.md not located on disk (best-effort P1..P7 walk applied); smoke gate must clear in CI before merge; transient `node_modules/.ignored` from local install probe needs `clean-install.sh` on workstation.
- Process learning: dispatch step-2 "no silent degradation" rule + Plan QC P-MAJ-01's "degrade-and-defer-to-convergence" pattern both worked well — worth promoting to canonical patterns.
