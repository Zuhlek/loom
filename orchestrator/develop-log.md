
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

## 2026-06-01 — csd-963-multi-portfolio-resolution / spec / phase
- Phase status: BLOCKED — AskUserQuestion is unavailable inside the Spec subagent, so the 5 branching questions could not be surfaced interactively. Wrote them fully-formed into decisions.md (Q1–Q5, all awaiting-answer) for the orchestrator to re-surface.
- Foundation finding: the "multi-mandate" logic the seed attributes to AbstractAityMapper actually lives in subclass AbstractAityCSVMapper (addTransaction isMultiMandate detection, getMultiMandateTransactions(), getSuspenseAccount()). Seed file reference is approximate (captured as Q5).
- Domain: Mandate(="partner") > Portfolio > {Depot, AccountPosition, SecurityPosition, CurrencyForward}; TransactionComponent="component". Every target has .mandate and (non-Mandate) .portfolio — so retargeting the boundary from mandate to portfolio is a clean accessor swap.
- Central design tension surfaced as Q1: suspense (Scharnier) accounts are currently per-mandate (hosted on lowest-id portfolio); splitting by portfolio likely requires per-portfolio keying for source books to balance.
- Drafted spec.md with 4 user stories (US-001..US-004) + constraints; all 5 decisions flagged under Open ambiguity since unconfirmed.
- Process note: phase contract says agent MAY use AskUserQuestion but the harness blocks it inside subagents — the interactive grilling loop cannot run here. Returned blocked with Pending user input rather than guessing answers.

## 2026-06-01 — csd-963-multi-portfolio-resolution / spec / phase
- Phase status: COMPLETE — re-dispatched to finalize after all 5 branching questions (Q1–Q5) were answered by the user in decisions.md. No re-grilling.
- Applied resolutions to spec.md: Q1=YES (suspense re-keyed per-portfolio, getSuspenseAccount(portfolio,currency), idPath <mandate>/<portfolio>/SCHARNIER_<CCY>); Q2=YES (only AccountPosition legs split, non-account legs keep raising "cannot map inter-portfolio" — Out of scope); Q3=YES (keep <id>/<n> external-id + SCHARNIER_<CCY> account-id, only host portfolio/idPath changes, no migration); Q4=Both (committed unit test + local protected-test S-3 scenario); Q5=YES (implement in AbstractAityCSVMapper).
- Made the now-definite ACs concrete: US-002 AC4 dropped "(pending decision Q2)"; US-003 AC2 names the per-portfolio host + idPath; US-004 ACs split into committed-unit-test (CI) + local protected S-3. All stories remain Status: active.
- Open ambiguity section replaced with a resolved-state statement (Q1–Q5 answered); no residual ambiguity. Design can proceed.

## 2026-06-01 — csd-963-multi-portfolio-resolution / spec / refine
- Targeted refine of 2 note-level quality-review findings; no re-grill, all Q1–Q5 decisions pinned, all 4 stories kept Status: active.
- Note 1 (portfolio accessor not uniform): verified in cinnamon-core InvestmentStructure.d.ts — abstract Target declares only `get mandate()` (L27); `.portfolio` exists on Depot (L92) and InvestmentPosition (L108, base of AccountPosition/SecurityPosition/CurrencyForward); Mandate has no .portfolio, Portfolio IS the portfolio. Reworded "What we're building" detection bullet + US-001 AC1 to say "portfolio-bearing targets" and flag per-class portfolio-key derivation as a Design concern; AC1 stays EARS-conformant (When...SHALL).
- Note 2 (suspense host under per-portfolio re-keying): verified getSuspenseAccount(mandate,currency) at AbstractAityCSVMapper.ts:354-362 picks lowest-id portfolio via getPortfoliosOfMandate(...).sort(...)[0]. Added a Scope clarification that under Q1=YES the suspense account is hosted on the target portfolio itself and that lowest-id-of-mandate host-selection branch is removed (host now passed in); mechanism left to Design.
- Both notes resolved at spec level; seven sections + EARS/story-marker shapes intact.

## 2026-06-01 — csd-963-multi-portfolio-resolution / design / phase
- Phase status: COMPLETE. design.md written (9 sections in contract order + Test design); no open ambiguity, no user block.
- Grounded in code: AbstractAityCSVMapper.ts addTransaction L216-270 (isMultiMandate→isMultiPortfolio local), getMultiMandateTransactions L297-351 (→getMultiPortfolioTransactions), getSuspenseAccount L353-385 (mandate→portfolio param). cinnamon-core InvestmentStructure.d.ts confirms abstract Target has only get mandate() (L27); .portfolio on Depot/InvestmentPosition (AccountPosition/SecurityPosition/CurrencyForward); Portfolio IS its portfolio; Mandate has none.
- ADR-1: portfolioOf(target) helper (instance-of dispatch), compare portfolios by idPath (reuses suspense key identity, distinguishes same-id portfolios across mandates). Rejected direct target.portfolio (throws on Mandate), reference-equality (re-fetched instances), and adding a core getter (out of scope).
- ADR-2: host suspense on the source portfolio passed in; drop getPortfoliosOfMandate(...).sort()[0] lowest-id branch + empty-portfolios throw (host now always exists). idPath stays <mandate>/<portfolio>/SCHARNIER_<CCY> with mandate=portfolio.mandate.id.
- ADR-3: keep buildExternalId <id>/<n> + SCHARNIER_<CCY> ids + cancelTransactions walk untouched (Q3); only the host portfolio segment of suspense idPath changes; no migration.
- ADR-4: committed unit test (new aper-interfaces/test/AbstractAityCSVMapper.test.ts, in-memory fake ISDBConnection, exercises split via addTransaction capture + balance asserts) + local protected S-3 scenario wired into AityCinnamonWorkflow.test.ts:144 describe-list (skips CI via fs.existsSync).
- Key handling decisions: trx.mandate derivation kept as-is (still needed for idPath prefix + error text); foreign debit/credit trx still uses target.mandate (=target.portfolio.mandate) + Mandate.NO_KEY guard; original-side kept iff originalPortfolio.key !== Portfolio.NO_KEY; non-account foreign legs keep raising "cannot map inter-portfolio" (Q2). Imports: Portfolio + InvestmentPosition must be added to top-of-file cinnamon-core import (AccountPosition/Mandate/Depot/Currency already present).
- Note for Plan/Build: "cannot map inter-portfolio" message interpolates trx.mandate.id/target.mandate.id which are now equal for intra-mandate splits — acceptable per Q2 (message wording out of scope).

## 2026-06-01 — csd-963-multi-portfolio-resolution / plan / phase
- Phase status: COMPLETE. Work graph written: plan.md, board.md, task.md, tests.md, tasks/T-001..T-005.md. 5 tasks (4 AFK, 1 HITL); DAG acyclic, all blocked-by resolve, all 4 stories (US-001..US-004) covered.
- Slicing: T-001 portfolioOf helper + imports (foundation, US-001) → T-002 detection rename/re-target isMultiMandate→isMultiPortfolio (US-001) → T-003 splitter rename getMultiPortfolioTransactions + suspense re-key getSuspenseAccount(portfolio,...) incl. non-account "cannot map inter-portfolio" error path (US-002+US-003, co-landed: split calls suspense inline, balance is one observable behaviour) → T-004 committed unit test (US-004 AC1/AC2, AFK) + T-005 protected S-3 golden master (US-004 AC3, HITL). T-001 is the one single-layer foundation task (justified: shared primitive, no behaviour of its own).
- Verification env: harness = node-test (Jest 29 + ts-jest, aper-interfaces/jest.config.js testRegex /test/.*\.test\.(jsx?|tsx?)$); `npm test` = jest --run-in-band --verbose; compile gate `npm run compile` (tsc). New AbstractAityCSVMapper.test.ts auto-discovered, runs fully in CI. T-005 protected golden master is local-only (protected-test/ not in repo + needs running core) — Build cannot run/regen it in CI; skipped via existing fs.existsSync guard; marked HITL.
- Mutation testing: NO. Rationale: balance invariant enforced at runtime (isRelevantAmount(balance)→addErrorIssue) so surviving-mutant surface is small and already pinned by per-trx balance asserts; change is rename+boundary re-target (dollar builders kept verbatim, not new arithmetic); no Stryker harness in repo; S-3 gives a second end-to-end balance check. Revisit if security/forward splitting (Q2) is broadened later.
- QC note pinned: T-004 includes an explicit assertion that original-side keep predicate change (Mandate.NO_KEY → Portfolio.NO_KEY) drops the original side when originalPortfolio.key === Portfolio.NO_KEY.

## 2026-06-01 — csd-963-multi-portfolio-resolution / plan / refine
- Targeted refine of 2 quality-review findings; DAG/slicing/task IDs untouched, all 5 tasks stay Backlog.
- Finding 1 (minor — T-005 frontmatter missing `type`): VERIFIED ALREADY PRESENT. tasks/T-005.md line 4 already carries `type: test` (correct casing/placement matching T-001..T-004). No edit needed — review was stale on this point.
- Finding 2 (note — US-003 AC4 no test sketch): confirmed spec.md US-003 AC4 (no orphan suspense account) and the retained guard `if (target.mandate.key !== Mandate.NO_KEY)` at AbstractAityCSVMapper.ts:329 wrapping the foreign debit/credit accountTrx. Appended assertion #8 to T-004's behavior-level sketch (foreign account leg with target.mandate.key === Mandate.NO_KEY → no debit/credit trx, no orphan suspense account; cites src:329, US-003 AC4). Existing assertions 1–7 left in place; no renumber.
- Only artifact touched: tasks/T-004.md. No DAG/board/plan/tests/task changes.

## 2026-06-01 — csd-963-multi-portfolio-resolution / build / phase
- Phase status: COMPLETE. T-001..T-004 green; T-005 hitl-block (protected golden-master, local-only). Artifacts: src refactor + new test + per-task logs/done reports + test-report.md + smoke-report.md.
- Pre-flight: jest + tsc confirmed runnable in aper-interfaces (node_modules/.bin present, `test` script = jest --run-in-band --verbose). Baseline suite green (3 protected scenarios SKIPPED via fs.existsSync). Harness OK → proceeded.
- Smoke (library refactor = compile + full suite): `tsc --noEmit --skipLibCheck` exit 0; `npx jest` → 2 suites / 9 tests pass (6 new + 3 skipped golden-master). IMPORTANT env note: plain `npm run compile` emits 124 errors ALL inside @types/node@25.9.1 lib .d.ts (pre-existing version mismatch, baseline-present); 0 reference src/ — used --skipLibCheck as the source-compile gate.
- Stale-symbol sweep clean: no isMultiMandate / getMultiMandateTransactions in repo; only internal getSuspenseAccount caller (now Portfolio); getPortfoliosOfMandate no longer called in src. All 16 AbstractAityCSVMapper subclasses compile unchanged (rename touched only private members + 1 local).
- No commits (per session hard rule + one-commit-per-task memory): changes left in working tree for review.

## 2026-06-01 — csd-963-multi-portfolio-resolution / build / task T-001
- green, 1 attempt. Added private portfolioOf(target): Portfolio | undefined (instance-of dispatch: Portfolio→self; Depot/InvestmentPosition→.portfolio; else undefined) + added Portfolio, InvestmentPosition, Target to the single-line cinnamon-core import. Foundation slice, gate=compile (clean). Runtime dispatch exercised by T-004.

## 2026-06-01 — csd-963-multi-portfolio-resolution / build / task T-002
- green, 1 attempt. addTransaction local isMultiMandate→isMultiPortfolio; detection now compares portfolioOf(target)?.idPath vs the first portfolio-bearing target's idPath; trx.mandate derivation kept; if-branch calls getMultiPortfolioTransactions. Genuine RED: reverting to old target.mandate.idPath fails 4 intra-mandate cross-portfolio assertions (T-002.test-log.txt).

## 2026-06-01 — csd-963-multi-portfolio-resolution / build / task T-003
- green, 1 attempt. getMultiMandateTransactions→getMultiPortfolioTransactions; originalPortfolio = first portfolio-bearing target; keep predicate Mandate.NO_KEY→originalPortfolio.key !== Portfolio.NO_KEY; per-target test → portfolioOf(target)?.idPath !== originalPortfolio?.idPath; suspense from getSuspenseAccount(originalPortfolio, ccy). getSuspenseAccount re-keyed (mandate→portfolio): host = passed-in portfolio, removed getPortfoliosOfMandate().sort()[0] + empty-portfolios throw; idPath ${portfolio.mandate.id}/${portfolio.id}/SCHARNIER_<CCY>; account id + cache + flow/debit/credit builders + non-account "Cannot map inter-portfolio" error + post-split loop + cancellation all unchanged (Q2/Q3). Genuine RED: reverting keep predicate to Mandate.NO_KEY fails the QC-pin test (T-003.test-log.txt).

## 2026-06-01 — csd-963-multi-portfolio-resolution / build / task T-004
- green, 1 attempt. New committed CI unit test aper-interfaces/test/AbstractAityCSVMapper.test.ts (6 cases) — in-memory fake ISDBConnection, no DB/protected data, reached via addTransaction capture. Enum sets minimally seeded (CHF; InvestmentType 'unassigned' for the mapper's Security placeholders + 'account'/'kind' for typeOfKind('K-scharnier'); Language de). setTransactionComponent overridden to mirror a balancing contra leg so emitted trxs genuinely balance. Covers US-001/002/003 ACs incl. SCHARNIER idPath on source portfolio, single-portfolio control, non-account error, Portfolio.NO_KEY pin, cache reuse, no-orphan-on-NO_KEY-mandate. Learning: a faithful in-memory unit test of this mapper needs 'unassigned' InvestmentType registered BEFORE the AbstractAityMapper ctor runs (it builds Security placeholders) and mandate.language set (foreign account-trx builder reads target.mandate.language.id).

## 2026-06-01 — csd-963-multi-portfolio-resolution / build / task T-005
- hitl-block, 0 attempts (HITL by design). Needs local-only protected-test/ data + running cinnamon-core to regenerate+validate the S-3 golden master; existing fs.existsSync guard skips it in CI. Left for local snapshot-regen workflow (add S-3 to AityCinnamonWorkflow.test.ts:144 describe-list, regenerate expected, git-diff, validate each diff). CI balance/split coverage already provided by T-004.

## 2026-06-01 — csd-963-multi-portfolio-resolution / review / phase
- Verdict: PASS. 0 blockers / 0 major / 0 minor / 2 notes. Review is the project-level QC (no separate QC phase). Artifacts: review.md, review-verdict.json.
- Intent: US-001..US-004 + Q1–Q5 all satisfied by the diff (isMultiPortfolio detection via portfolioOf(...).idPath; per-portfolio split with retained original side; per-portfolio SCHARNIER_<CCY> hosted on source portfolio idPath <mandate>/<portfolio>/...; non-account legs still error per Q2; id/cancellation schemes unchanged per Q3; implemented in AbstractAityCSVMapper per Q5).
- Design: ADR-1..ADR-4 conformant. portfolioOf instance-of dispatch keyed by idPath; lowest-id host branch + getPortfoliosOfMandate removed (confirmed: no getPortfoliosOfMandate in src); keep predicate now originalPortfolio.key !== Portfolio.NO_KEY.
- Re-verified evidence independently: unit test 6/6 PASS; tsc --noEmit --skipLibCheck exit 0 (0 src/test errors; 124 plain-compile errors all @types/node lib noise, baseline-present); stale-symbol sweep clean (no isMultiMandate/getMultiMandateTransactions; only internal getSuspenseAccount caller, now Portfolio).
- Plan: 4/5 Done; T-005 (protected golden-master S-3) HITL-blocked — accepted, clearly-routed risk per Q4/plan, NOT a blocker (CI coverage by T-004). Routed to local HITL build step (snapshot-regen workflow).
- Notes (2): (1) T-005 protected golden-master deferred to operator/local HITL; (2) non-account inter-portfolio error message interpolates mandate ids (reads "between M1 and M1" intra-mandate) — cosmetic, out of scope per Q2, flagged for a future ticket.
- Safety: no commits/destructive ops; diff confined to AbstractAityCSVMapper.ts + new test file. (.gitignore M / .forge untracked are pipeline bookkeeping, outside code review.)
- Process learning captured: tsc --skipLibCheck is the correct source-compile gate for aper-interfaces (avoids @types/node false FAIL); in-memory mapper unit tests need 'unassigned' InvestmentType registered pre-ctor + mandate.language set.
