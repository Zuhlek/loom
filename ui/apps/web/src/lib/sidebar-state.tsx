/**
 * SidebarStateProvider — fetches /api/sidebar/state on mount and exposes
 * a refresh() method so children can re-read after mutations (spawn chat,
 * etc.). Also polls every 5 s in case the backend was modified out of band
 * (e.g. another loom client created a chat).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getSidebarState, type SidebarState } from "./api";

interface SidebarStateContextValue {
  state: SidebarState | null;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
}

const SidebarStateContext = createContext<SidebarStateContextValue | null>(null);

export function SidebarStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SidebarState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getSidebarState();
      if (!mountedRef.current) return;
      setState(next);
      setError(null);
    } catch (err: any) {
      if (!mountedRef.current) return;
      setError(err?.message ?? "fetch failed");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  return (
    <SidebarStateContext.Provider value={{ state, loading, error, refresh }}>
      {children}
    </SidebarStateContext.Provider>
  );
}

export function useSidebarState(): SidebarStateContextValue {
  const ctx = useContext(SidebarStateContext);
  if (!ctx) {
    // If the provider isn't mounted (e.g. on the index page), surface a
    // no-op state instead of throwing — callers handle null gracefully.
    return {
      state: null,
      loading: false,
      error: null,
      refresh: async () => {},
    };
  }
  return ctx;
}
