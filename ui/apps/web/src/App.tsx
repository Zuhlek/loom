import { Route, Switch } from "wouter";
import { AppSidebarLayout } from "./components/layout/AppSidebarLayout";
import { DiscoverWizard } from "./routes/discover-wizard";
import { EmptyHome } from "./routes/empty-home";
import { LiveHome } from "./routes/live-home";
import { ChatRoute } from "./routes/chat";
import { LiveChatRoute } from "./routes/live-chat";
import { LoomView } from "./routes/loom-view";
import { LoomViewLive } from "./routes/loom-view-live";
import { Settings } from "./routes/settings";
import { SpawnChatDialogPage } from "./routes/spawn-chat-dialog";
import { MultiTabSameCwd } from "./routes/multi-tab-same-cwd";
import { MultiPathProject } from "./routes/multi-path-project";
import { HandoffForkMenu } from "./routes/handoff-fork-menu";
import { Index } from "./routes/index-page";
import { SidebarStateProvider } from "./lib/sidebar-state";

export function App() {
  return (
    <SidebarStateProvider>
      <Switch>
        <Route path="/" component={LiveHome} />
        <Route path="/index" component={Index} />
        <Route path="/discover" component={DiscoverWizard} />
        <Route path="/empty" component={EmptyHome} />
        <Route path="/spawn" component={SpawnChatDialogPage} />
        <Route path="/chat/:id">
          {(params: { id: string }) => <LiveChatRoute chatId={params.id} />}
        </Route>
        <Route path="/chat-mock/:variant?">
          {(params: { variant?: string }) => (
            <AppSidebarLayout>
              <ChatRoute variant={params.variant ?? "local"} />
            </AppSidebarLayout>
          )}
        </Route>
        <Route path="/loom/:projectId/:loomName">
          {(params: { projectId: string; loomName: string }) => (
            <LoomViewLive
              projectId={decodeURIComponent(params.projectId)}
              loomName={decodeURIComponent(params.loomName)}
            />
          )}
        </Route>
        <Route path="/loom/:phase?">
          {(params: { phase?: string }) => (
            <AppSidebarLayout>
              <LoomView phase={params.phase ?? "idea"} />
            </AppSidebarLayout>
          )}
        </Route>
        <Route path="/settings/:variant?">
          {(params: { variant?: string }) => <Settings variant={params.variant ?? "default"} />}
        </Route>
        <Route path="/multi-tab" component={MultiTabSameCwd} />
        <Route path="/multi-path" component={MultiPathProject} />
        <Route path="/handoff" component={HandoffForkMenu} />
        <Route>
          <div className="grid place-items-center h-screen text-sm text-[var(--muted-foreground)]">
            Page not found —{" "}
            <a className="ml-1 underline" href="/">
              home
            </a>
          </div>
        </Route>
      </Switch>
    </SidebarStateProvider>
  );
}
