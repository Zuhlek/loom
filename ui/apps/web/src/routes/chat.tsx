import type { ReactNode } from "react";
import { ChatHeader } from "../components/chat/ChatHeader";
import { ChatComposer } from "../components/chat/ChatComposer";
import { ChatMessage, SubagentCard, SlashCommandDivider } from "../components/chat/ChatMessages";
import { AskUserQuestionPicker } from "../components/chat/AskUserQuestionPicker";
import { PermissionRequestInline } from "../components/chat/PermissionRequestInline";
import { DiffPanelShell, type DiffFile } from "../components/diff/DiffPanel";

const SAMPLE_DIFF: DiffFile[] = [
  {
    path: ".github/workflows/deploy.yml",
    status: "added",
    added: 42,
    removed: 0,
    hunks: [
      [
        { kind: "meta", text: "@@ -0,0 +1,42 @@" },
        { kind: "add", text: "name: deploy" },
        { kind: "add", text: "on:" },
        { kind: "add", text: "  push:" },
        { kind: "add", text: "    branches: [main]" },
        { kind: "add", text: "jobs:" },
        { kind: "add", text: "  build:" },
        { kind: "add", text: "    runs-on: ubuntu-latest" },
        { kind: "add", text: "    steps:" },
        { kind: "add", text: "      - uses: actions/checkout@v4" },
        { kind: "add", text: "      - uses: oven-sh/setup-bun@v1" },
        { kind: "add", text: "      - run: bun install --frozen-lockfile" },
        { kind: "add", text: "      - run: bun run build" },
        { kind: "add", text: "      - run: bun scripts/migrate.ts --smoke" },
      ],
    ],
  },
  {
    path: "scripts/migrate.ts",
    status: "modified",
    added: 18,
    removed: 3,
    hunks: [
      [
        { kind: "meta", text: "@@ -12,7 +12,22 @@ async function migrate() {" },
        { kind: "context", text: " const pg = new PGlite(dbPath);" },
        { kind: "del", text: " await pg.exec(SCHEMA_SQL);" },
        { kind: "del", text: ' console.log("done");' },
        { kind: "del", text: "}" },
        { kind: "add", text: " const tx = await pg.transaction();" },
        { kind: "add", text: " await tx.exec(SCHEMA_SQL);" },
        { kind: "add", text: ' if (process.argv.includes("--smoke")) {' },
        { kind: "add", text: '   const rows = await tx.query("SELECT 1 AS ok");' },
        { kind: "add", text: '   if (rows[0]?.ok !== 1) throw new Error("smoke");' },
        { kind: "add", text: " }" },
        { kind: "add", text: " await tx.commit();" },
        { kind: "add", text: ' console.log("migrate ok");' },
        { kind: "add", text: "}" },
      ],
    ],
  },
];

interface ChatRouteProps {
  variant: string;
}

/**
 * Mockups 04, 05, 10, 11, 12. Variant selector decides which sample chat
 * gets rendered. The sidebar lives outside this component (AppSidebarLayout
 * mounts it).
 */
export function ChatRoute({ variant }: ChatRouteProps) {
  const isWorktree = variant === "worktree";
  const isAsk = variant === "askuserquestion";
  const isPermission = variant === "permission";
  const isMultiTab = variant === "multi-tab";

  const messages: ReactNode[] = [];

  if (isAsk) {
    messages.push(
      <ChatMessage key="u1" role="user" subtitle="Yesterday">
        <div className="text-sm">
          /weave refine the worktree-mode story for nora — should it default to ON for git repos?
        </div>
      </ChatMessage>,
      <ChatMessage key="a1" role="assistant" subtitle="claude-opus-4-7">
        <div className="text-sm">
          I have three options. Picking the right default has downstream costs (S/M sizes, complexity tradeoffs).
        </div>
      </ChatMessage>,
      <AskUserQuestionPicker
        key="ask"
        question="Which worktree default should nora ship?"
        options={[
          { id: "a", label: "A. Genuine t3code mimic — opt-in worktree, default OFF", badge: "S, Low", detail: "Spawn dialog has a checkbox unchecked at open; matches t3code's mode parameter exactly." },
          { id: "b", label: "B. Worktree-leaning — opt-in worktree, default ON", badge: "S, Low", detail: "User can uncheck for local mode; ships MORE opinionated than t3code on the default." },
          { id: "c", label: "C. Auto-isolate on /weave Phase 4 build only", badge: "M, Med", detail: "Couples worktree behavior to /weave phase detection — at odds with Q1's command-agnostic commitment." },
        ]}
      />,
    );
  } else if (isPermission) {
    messages.push(
      <ChatMessage key="a1" role="assistant" subtitle="11:24 AM">
        <div className="text-sm">
          Editing <code className="font-mono px-1 rounded text-[12px]" style={{ background: "var(--muted)" }}>sidebarProjectGrouping.ts</code> next, then I'll run the test suite.
        </div>
      </ChatMessage>,
      <PermissionRequestInline
        key="perm"
        tool="Bash"
        prompt="Run bun test apps/web/src/components/Sidebar.logic.test.ts?"
        args={{
          command: "bun test apps/web/src/components/Sidebar.logic.test.ts",
          cwd: "/Users/tristan/dev/repo/nora",
          timeout: "60000ms",
          env: "CI=1 NODE_ENV=test",
        }}
        reason="Verify Sidebar grouping snapshot tests still pass after extending SidebarProjectSnapshot."
      />,
      <div key="hint" className="ml-10 rounded-md p-2 border border-dashed text-[10px] flex items-center gap-1.5" style={{ borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
        Sidebar row shows the same{" "}
        <span className="inline-block size-1.5 rounded-full align-middle awaiting-pulse" style={{ background: "var(--warning)" }} /> badge as for AskUserQuestion (SR-38).
      </div>,
    );
  } else {
    messages.push(
      <ChatMessage key="u1" role="user" subtitle="10:42 AM">
        <div className="text-sm leading-relaxed">
          Tighten the Sidebar.tsx grouping so chats and looms sit under the same Project header. Use ChevronRight rotating on expand.{" "}
          <span className="font-mono px-1 rounded text-[12px]" style={{ background: "var(--muted)" }}>
            @apps/web/src/components/Sidebar.tsx
          </span>
        </div>
      </ChatMessage>,
      <ChatMessage key="a1" role="assistant" subtitle="claude-opus-4-7 · 10:42 AM">
        <div className="text-sm leading-relaxed space-y-2">
          <p>
            Reading <code className="font-mono text-[12px] px-1 rounded" style={{ background: "var(--muted)" }}>apps/web/src/components/Sidebar.tsx</code> first to understand the current grouping pattern.
          </p>
        </div>
        <SubagentCard tool="Read" target="apps/web/src/components/Sidebar.tsx" summary="2147 lines · 1.2s" />
        <div className="mt-2 text-sm leading-relaxed">
          <p>The current Sidebar groups by physical project key. To unify Chats and Looms under one header, we'd add a loom sub-list mirroring the chat list pattern. Two changes:</p>
          <ul className="mt-1.5 list-disc ml-5 space-y-0.5 text-sm">
            <li>
              Extend <code className="font-mono text-[12px] px-1 rounded" style={{ background: "var(--muted)" }}>SidebarProjectSnapshot</code> with a <code className="font-mono text-[12px] px-1 rounded" style={{ background: "var(--muted)" }}>looms</code> field.
            </li>
            <li>Render a second sub-section under the project header using the same row pattern.</li>
          </ul>
        </div>
      </ChatMessage>,
      <SlashCommandDivider key="div" command="/clear" />,
      <ChatMessage key="u2" role="user" subtitle="10:48 AM">
        <div className="text-sm leading-relaxed">Cool, draft the snapshot extension first.</div>
      </ChatMessage>,
      <ChatMessage key="a2" role="assistant" subtitle="10:48 AM · streaming" streaming>
        <div className="text-sm leading-relaxed">
          Adding a <code className="font-mono text-[12px] px-1 rounded" style={{ background: "var(--muted)" }}>looms: Array&lt;LoomRow&gt;</code> field on the snapshot. The snapshot builder will need a parallel scan of <code className="font-mono text-[12px] px-1 rounded" style={{ background: "var(--muted)" }}>project.paths × .loom/*/</code>...
        </div>
      </ChatMessage>,
    );
  }

  if (isWorktree) {
    return (
      <div className="flex-1 flex min-w-0">
        <div className="flex-1 flex flex-col min-w-0">
          <ChatHeader
            title="Plan deployment"
            permissionMode="default"
            cwd="~/dev/repo/nora"
            mode="worktree"
            branch="nora/plan-deploy/abc123"
          />
          <div className="flex-1 overflow-y-auto px-4 py-5">
            <div className="max-w-2xl mx-auto space-y-5">
              <ChatMessage role="user" subtitle="2:14 PM">
                <div className="text-sm">Build a deploy workflow + the smoke step.</div>
              </ChatMessage>
              <ChatMessage role="assistant" subtitle="2:14 PM">
                <div className="text-sm">
                  Drafted the workflow at <code className="font-mono text-[12px] px-1 rounded" style={{ background: "var(--muted)" }}>.github/workflows/deploy.yml</code> and added the smoke step to <code className="font-mono text-[12px] px-1 rounded" style={{ background: "var(--muted)" }}>scripts/migrate.ts</code>.
                </div>
                <SubagentCard tool="Edit" target=".github/workflows/deploy.yml" summary="+42 lines" />
                <SubagentCard tool="Edit" target="scripts/migrate.ts" summary="+18 −3" />
              </ChatMessage>
            </div>
          </div>
          <ChatComposer compact />
        </div>
        <DiffPanelShell
          branchToolbar={{
            branch: "nora/plan-deploy/abc123",
            base: "main",
            uncommitted: true,
            remote: "github",
          }}
          diffProps={{ files: SAMPLE_DIFF, scopeSubtitle: "turn 4 of 7" }}
        />
      </div>
    );
  }

  const title = isAsk
    ? "Decide worktree default"
    : isPermission
    ? "Refine sidebar grouping"
    : isMultiTab
    ? "Refine sidebar layout (tab 2)"
    : "Refine sidebar layout";

  return (
    <>
      <ChatHeader title={title} permissionMode="default" cwd="~/dev/repo/nora" mode="local" />
      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="max-w-3xl mx-auto space-y-5">{messages}</div>
      </div>
      <ChatComposer disabled={isAsk || isPermission} disabledReason={isAsk ? "Locked — answer the question above" : isPermission ? "Locked — resolve approval above" : undefined} />
    </>
  );
}
