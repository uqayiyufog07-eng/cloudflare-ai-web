import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { useAuthRetry } from "@/hooks/use-auth-retry";
import { useScrollToBottom } from "@/hooks/use-scroll-to-bottom";
import {
  appendConversationMessage,
  createUserMessage,
  loadConversationHistory,
  type RemoteStoredMessage,
} from "@/lib/conversation-api";
import { fitImagePartsWithinLimit } from "@/lib/image-compression";
import { buildModelContext } from "@/lib/model-context";
import type { Model } from "@/lib/models";
import { getCookie, getStoredModel } from "@/lib/utils";

const MAX_TOAST_LENGTH = 100;

const showError = (message: string) => {
  toast.add({
    title:
      message.length > MAX_TOAST_LENGTH
        ? `${message.slice(0, MAX_TOAST_LENGTH)}...`
        : message || "Unknown error occurred. Please try again.",
    type: "error",
  });
};

const isUnauthorized = (error: unknown) => (error as Error).message === "Unauthorized";

type RetryAction = { type: "load" } | { type: "send"; text: string; files?: FileUIPart[] };

/**
 * Drives one Conversation History: loads its cloud messages, persists each
 * finished message, and starts the first response when the conversation was
 * just created. A 401 on any step opens the password dialog and replays the
 * interrupted step once after authentication.
 */
export const useConversation = ({
  sessionId,
  isNew,
  models,
}: {
  sessionId: string;
  isNew: boolean;
  models: Model[];
}) => {
  const scroll = useScrollToBottom();
  const [startsWithPendingMessage] = useState(isNew);
  const retryActionRef = useRef<RetryAction | null>(null);

  const { messages, sendMessage, status, setMessages, stop, regenerate } = useChat({
    id: sessionId,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: async ({ messages }) => {
        const selectedModel = getStoredModel(models, "CF_AI_MODEL");
        if (!selectedModel) {
          throw new Error("No chat models are currently available");
        }

        const modelContext = buildModelContext(messages);
        if (!modelContext) {
          throw new Error("The latest message exceeds the 64,000-character context limit.");
        }

        return {
          body: {
            messages: await fitImagePartsWithinLimit(modelContext),
            model: selectedModel.id,
            provider: selectedModel.provider,
            search: getCookie("CF_AI_SEARCH_ENABLED") === "true",
          },
        };
      },
    }),
    onFinish: ({ message, messages, isError }) => {
      // An aborted request that produced nothing reports an assistant message that was
      // never added to the list; only persist responses the user actually saw.
      const isVisible = messages.some((candidate) => candidate.id === message.id);
      if (isError || !isVisible || message.parts.length === 0) {
        return;
      }

      resetAuthRetry();
      appendConversationMessage(sessionId, message).catch((error) => {
        if (isUnauthorized(error)) {
          // Default replay after auth is regenerating the assistant response.
          retryActionRef.current = null;
          handleUnauthorized();
          return;
        }
        showError("Unable to save the response to chat history.");
      });
    },
    onError: (error) => {
      if (error.message === "Unauthorized") {
        retryActionRef.current = null;
        handleUnauthorized();
        return;
      }
      showError(error.message);
    },
  });

  // Declared before the callbacks below because their dependency arrays read
  // handleUnauthorized immediately during render. The replay closure itself
  // references persistAndSend/retryLoad, which are only invoked later.
  const { authDialog, handleUnauthorized, resetAuthRetry } = useAuthRetry(() => {
    const action = retryActionRef.current;
    if (action?.type === "send") {
      retryActionRef.current = null;
      void persistAndSend(action.text, action.files);
    } else if (action?.type === "load") {
      retryActionRef.current = null;
      retryLoad();
    } else {
      void regenerate();
    }
  });

  const applyLoadedHistory = useCallback(
    (history: RemoteStoredMessage[]) => {
      setMessages(history);
      if (startsWithPendingMessage && history.at(-1)?.role === "user") {
        window.history.replaceState(null, "", location.pathname);
        void regenerate();
      }
    },
    [startsWithPendingMessage, setMessages, regenerate],
  );

  const handleLoadFailure = useCallback(
    (error: unknown) => {
      if (isUnauthorized(error)) {
        retryActionRef.current = { type: "load" };
        handleUnauthorized();
        return;
      }
      showError("Unable to load chat history.");
    },
    [handleUnauthorized],
  );

  const retryLoad = useCallback(() => {
    void loadConversationHistory(sessionId).then(applyLoadedHistory).catch(handleLoadFailure);
  }, [sessionId, applyLoadedHistory, handleLoadFailure]);

  const persistAndSend = useCallback(
    async (text: string, files?: FileUIPart[]) => {
      const message = createUserMessage(text, files);
      try {
        await appendConversationMessage(sessionId, message);
      } catch (error) {
        if (isUnauthorized(error)) {
          retryActionRef.current = { type: "send", text, files };
          handleUnauthorized();
          return;
        }
        showError("Unable to save the message to chat history.");
        return;
      }

      scroll.scrollToBottom();
      await sendMessage(message);
    },
    [sessionId, sendMessage, scroll, handleUnauthorized],
  );

  useEffect(() => {
    let cancelled = false;
    loadConversationHistory(sessionId)
      .then((history) => {
        if (!cancelled) {
          applyLoadedHistory(history);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          handleLoadFailure(error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, applyLoadedHistory, handleLoadFailure]);

  useEffect(() => {
    if (status === "streaming") {
      scroll.followIfNearBottom();
    }
  }, [status, messages, scroll.followIfNearBottom]);

  const send = useCallback(
    (text: string, files?: FileUIPart[]) => {
      resetAuthRetry();
      void persistAndSend(text, files);
    },
    [resetAuthRetry, persistAndSend],
  );

  return { messages, status, send, stop, regenerate, authDialog, scroll };
};
