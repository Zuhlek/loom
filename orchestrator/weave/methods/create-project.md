# Create Project

Create `.loom/<project>/` from a seed.

## Steps

1. Derive a kebab-case project name.
2. **Overlap scan.** Before continuing, scan existing `.loom/*/spec.md` and `.loom/*/seed.md`. If any project's seed or "What we're building" section has substantial overlap (>0.4 token Jaccard) with the new seed, surface via `AskUserQuestion`: *"This looks similar to existing project `<name>` (seed: `<one-line>`). Continue that project, or create a new one?"* On "Continue existing", dispatch `find-project` for the existing name and exit `create-project` without creating a new workspace. Skip the scan when `.loom/` has no projects yet.
3. **Inline every referenced source byte-for-byte.** If the user's input references external content — `@path/to/file`, a raw filesystem path, a URL, a pasted attachment marker, a screenshot path, etc. — **read the referenced content now and inline it verbatim into the seed text** before passing `--seed` to the CLI. Never pass just the reference. The referenced source may be temporary (a scratch file, a session-only attachment, a chat-uploaded image, a URL that may go offline); if it disappears later, `seed.md` must still fully reflect the original input. For each inlined source, wrap it with a clear provenance block so the boundary is recoverable:

   ```
   <!-- loom:seed-source kind=file|url|paste path="<original-ref>" fetched="<ISO-timestamp>" -->
   <verbatim content, unmodified>
   <!-- loom:seed-source end -->
   ```

   Rules:
   - **Byte-for-byte.** Do not summarize, reformat, re-wrap, translate, or "clean up" the source. Copy the exact bytes (text files) or a base64/description block (binary/image) plus the original path.
   - **Multiple references** in one input each get their own provenance block, in the order they appeared.
   - **Unreachable references** (file missing, URL fails) abort `create-project` with a clear error to the user; do not silently fall back to the bare reference.
   - **Inline user prose** that surrounded the reference stays in place around the provenance blocks, so the seed reads as the user wrote it but with every linked artifact fully captured.

4. Extract optional ticket ID and type hint from the (now fully inlined) seed. Full inlining is also what powers Spec's seed-settled pre-answers (`phases/spec/methods/grilling.md § 0.5`): a ticket or backlog entry captured verbatim here means its explicit decisions and acceptance criteria are never re-asked during grilling.
5. Run `orchestrator/weave/lib/pipeline-parser.py init <parent_dir> <project> [--seed ...] [--ticket ...] [--type-hint ...]`. The CLI takes the **parent directory** (typically the project root or the active workspace parent); it constructs `<parent_dir>/.loom/<project>/` itself and writes `pipeline.md` and `seed.md` into it. `Lifecycle state` is initialized to `active`. The CLI errors if `seed.md` already exists at the target — handle that as a recovery prompt for the user.
6. Initial state (set by `init`): current phase `spec`, status `Pending`, lifecycle state `active`, resume point `spec:foundation`.
7. Type guidance (set by `init`): when the type hint names a known `types/<type>.md`, the CLI also materializes it into the workspace as `.loom/<project>/type-guidance.md` so phase agents read domain guidance from their inherited cwd rather than a cross-tree skill path. Unknown or empty type hints produce no file — the `type-guidance.md` input is conditional, read only when present.
8. **Target repo.** Determine the target repo from the file paths the (now fully inlined) seed references. Resolve its root with:

   ```
   git -C <path> rev-parse --path-format=absolute --git-common-dir   # strip the trailing /.git
   ```

   Use this, not `--show-toplevel`: inside a linked worktree `--show-toplevel` returns the worktree, while `--git-common-dir` resolves back to the main checkout — so every worktree of a repo resolves to the same `Repo`, and the same rules. A bare `git rev-parse` in the weave session cwd fails (it is a collection directory containing `.loom/` but no `.git`), and Loom's own `.loom/`-based root walk stops at that same collection directory; use neither.

   Record the resolved root as the `Repo` field and announce it: `orchestrator/weave/lib/pipeline-parser.py update <parent_dir>/.loom/<project>/pipeline.md Repo <root>`. It is where phase agents read this repo's rules from, and where the Review gate writes approved ones. Loom writes nothing into the repo at project creation.

   When git resolves nothing, `Repo` is still a directory, not a git fact — a plain folder holds `.claude/rules/` just as well:

   - **The seed references a folder that is not a git repo** — ask ONCE via `AskUserQuestion`: *"`<path>` is not a git repo. Which directory should rules for this work be filed under?"* Offer the common ancestor of the paths the seed references as the first option, the single referenced directory as the second. Record the answer as `Repo` and continue. Never infer it silently: an ancestor walk can land on a parent that spans unrelated projects, and all of them would then share rules.
   - **The seed references no external paths at all** (greenfield work built inside `.loom/<project>/`) — leave `Repo` empty. The run has no repo-scoped target and the Review gate reports "no target". Do not ask; there is nothing to file against.
