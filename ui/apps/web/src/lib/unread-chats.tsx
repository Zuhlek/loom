/**
 * UnreadChatsProvider — tracks which chats have produced assistant
 * output the user hasn't viewed yet, so the sidebar can render a
 * pulsing highlight on those rows.
 *
 * Signal: a chat is "unread" when its `live.turnState` transitions
 * from `running` (or `interrupted`) to `idle` while the user is not
 * currently viewing that chat. The first poll after mount only seeds
 * the previous-state map — it never marks anything unread, so we
 * don't light up every idle chat on page load.
 *
 * Clearing: navigating to a chat (location matches `/chat/<id>`) or
 * calling `markRead(id)` directly clears its unread state. The set
 * is persisted to `localStorage` so a page reload preserves what
 * you've already seen vs. not.
 *
 * Priority in the sidebar glyph stack stays: needsInput > running >
 * unread > idle. The pulse here is a *row* highlight, not a glyph,
 * so it composes with the existing `LiveStatusGlyph`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "wouter";
import { useSidebarState } from "./sidebar-state";
import type { ApiChat } from "./api";

const STORAGE_KEY = "loom.unread-chats.v1";

interface UnreadChatsContextValue {
  /** True iff `chatId` has unviewed assistant output. */
  isUnread(chatId: string): boolean;
  /** Clear the unread flag for a chat (e.g. on click). */
  markRead(chatId: string): void;
}

const UnreadChatsContext = createContext<UnreadChatsContextValue | null>(null);

function loadInitialUnread(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((x) => typeof x === "string"));
  } catch {
    /* ignore corrupt storage */
  }
  return new Set();
}

function extractActiveChatId(location: string): string | null {
  const m = location.match(/^\/chat\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function UnreadChatsProvider({ children }: { children: ReactNode }) {
  const { state } = useSidebarState();
  const [location] = useLocation();
  const [unread, setUnread] = useState<Set<string>>(loadInitialUnread);

  /**
   * Last-seen `turnState` per chat id. `null` until the first poll
   * arrives so we can distinguish "fresh mount" (don't mark anyone
   * unread) from "subsequent poll" (transitions are meaningful).
   */
  const prevTurnStateRef = useRef<Map<string, string> | null>(null);

  const activeChatId = useMemo(() => extractActiveChatId(location), [location]);

  // Detect running -> idle transitions on each poll.
  useEffect(() => {
    if (!state) return;
    const allChats: ApiChat[] = [
      ...state.groups.flatMap((g) => g.chats),
      ...state.unassigned,
    ];
    const prev = prevTurnStateRef.current;
    const next = new Map<string, string>();
    const newlyUnread: string[] = [];
    for (const chat of allChats) {
      const cur = chat.live?.turnState ?? "idle";
      next.set(chat.id, cur);
      if (!prev) continue; // first poll: seed only, no transitions
      const before = prev.get(chat.id);
      const wasWorking = before === "running" || before === "interrupted";
      const nowDone = cur === "idle";
      if (wasWorking && nowDone && chat.id !== activeChatId) {
        newlyUnread.push(chat.id);
      }
    }
    prevTurnStateRef.current = next;

    if (newlyUnread.length > 0) {
      setUnread((curUnread) => {
        let changed = false;
        const updated = new Set(curUnread);
        for (const id of newlyUnread) {
          if (!updated.has(id)) {
            updated.add(id);
            changed = true;
          }
        }
        return changed ? updated : curUnread;
      });
    }
  }, [state, activeChatId]);

  // Auto-clear the active chat's unread flag.
  useEffect(() => {
    if (!activeChatId) return;
    setUnread((cur) => {
      if (!cur.has(activeChatId)) return cur;
      const next = new Set(cur);
      next.delete(activeChatId);
      return next;
    });
  }, [activeChatId]);

  // Drop unread ids for chats that no longer exist (deleted).
  useEffect(() => {
    if (!state) return;
    const knownIds = new Set<string>();
    for (const g of state.groups) for (const c of g.chats) knownIds.add(c.id);
    for (const c of state.unassigned) knownIds.add(c.id);
    setUnread((cur) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of cur) {
        if (knownIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : cur;
    });
  }, [state]);

  // Persist.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...unread]));
    } catch {
      /* storage full / disabled — silently ignore */
    }
  }, [unread]);

  const markRead = useCallback((chatId: string) => {
    setUnread((cur) => {
      if (!cur.has(chatId)) return cur;
      const next = new Set(cur);
      next.delete(chatId);
      return next;
    });
  }, []);

  const value = useMemo<UnreadChatsContextValue>(
    () => ({
      isUnread: (chatId: string) => unread.has(chatId),
      markRead,
    }),
    [unread, markRead],
  );

  return (
    <UnreadChatsContext.Provider value={value}>{children}</UnreadChatsContext.Provider>
  );
}

export function useUnreadChats(): UnreadChatsContextValue {
  const ctx = useContext(UnreadChatsContext);
  if (!ctx) {
    return {
      isUnread: () => false,
      markRead: () => {},
    };
  }
  return ctx;
}
