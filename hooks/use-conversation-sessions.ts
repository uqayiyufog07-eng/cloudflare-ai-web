import { useCallback, useEffect, useState } from "react";
import {
  CONVERSATIONS_CHANGED_EVENT,
  listRecentSessions,
  type RemoteSession,
} from "@/lib/conversation-api";

/**
 * Loads the cloud-backed session list for the sidebar.
 *
 * Refetches when this client writes/deletes a conversation
 * (`cf-ai:conversations-changed`) and whenever the window regains focus or
 * becomes visible again — the latter is what surfaces conversations created
 * on another device. A 401 is treated as an empty list with no toast: the chat
 * page owns the password dialog, and a later focus/change repopulates the list.
 */
export const useConversationSessions = () => {
  const [sessions, setSessions] = useState<RemoteSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSessions(await listRecentSessions());
    } catch (error) {
      if ((error as Error).message !== "Unauthorized") {
        // Keep the previously loaded list visible on transient errors.
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    const onChange = () => {
      void refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    globalThis.addEventListener(CONVERSATIONS_CHANGED_EVENT, onChange);
    window.addEventListener("focus", onChange);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      globalThis.removeEventListener(CONVERSATIONS_CHANGED_EVENT, onChange);
      window.removeEventListener("focus", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { sessions, isLoading };
};
