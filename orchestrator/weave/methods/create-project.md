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

4. Extract optional ticket ID and type hint from the (now fully inlined) seed.
5. Run `orchestrator/lib/pipeline-parser.py init <parent_dir> <project> [--seed ...] [--ticket ...] [--type-hint ...]`. The CLI takes the **parent directory** (typically the project root or the active workspace parent); it constructs `<parent_dir>/.loom/<project>/` itself and writes `pipeline.md` and `seed.md` into it. `Lifecycle state` is initialized to `active`. The CLI errors if `seed.md` already exists at the target — handle that as a recovery prompt for the user.
6. Initial state (set by `init`): current phase `spec`, status `Pending`, lifecycle state `active`, resume point `spec:foundation`.
