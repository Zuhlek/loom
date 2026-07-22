import { Route, Switch } from "wouter";
import { LiveHome } from "./routes/live-home";
import { LiveChatRoute } from "./routes/live-chat";
import { FabricViewLive } from "./routes/fabric-view-live";
import { Settings } from "./routes/settings";
import { SidebarStateProvider } from "./lib/sidebar-state";
import { UnreadChatsProvider } from "./lib/unread-chats";
import { SnackbarProvider } from "./components/ui/Snackbar";
import { BackendOfflineBanner } from "./components/BackendOfflineBanner";
import { HooksHealthBanner } from "./components/HooksHealthBanner";
import { useHealthPoll } from "./lib/useHealthPoll";

export function App() {
  const health = useHealthPoll();
  return (
    <SnackbarProvider>
      <SidebarStateProvider>
        <UnreadChatsProvider>
        <BackendOfflineBanner
          offline={health.isOffline}
          offlineSince={health.offlineSince}
          onRetry={health.retryNow}
        />
        {!health.isOffline && <HooksHealthBanner />}
        <Switch>
        <Route path="/" component={LiveHome} />
        <Route path="/chat/:id">
          {(params: { id: string }) => <LiveChatRoute chatId={params.id} />}
        </Route>
        <Route path="/fabric/:projectId/:fabricName">
          {(params: { projectId: string; fabricName: string }) => (
            <FabricViewLive
              projectId={decodeURIComponent(params.projectId)}
              fabricName={decodeURIComponent(params.fabricName)}
            />
          )}
        </Route>
        <Route path="/settings/:variant?">
          {(params: { variant?: string }) => <Settings variant={params.variant} />}
        </Route>
        <Route>
          <div className="grid place-items-center h-screen text-sm text-[var(--muted-foreground)]">
            Page not found —{" "}
            <a className="ml-1 underline" href="/">
              home
            </a>
          </div>
        </Route>
        </Switch>
        </UnreadChatsProvider>
      </SidebarStateProvider>
    </SnackbarProvider>
  );
}
