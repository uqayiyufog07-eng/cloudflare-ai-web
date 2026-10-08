"use client";

import { useRouter } from "next/navigation";
import { useRef, ViewTransition } from "react";
import AuthDialog from "@/components/auth-dialog";
import ChatInput, { type onSendMessageProps } from "@/components/chat-input";
import Footer from "@/components/footer";
import { useModelCatalog } from "@/components/model-catalog-provider";
import { toast } from "@/components/ui/toast";
import { TextEffect } from "@/components/ui/text-effect";
import { useAuthRetry } from "@/hooks/use-auth-retry";
import { createConversation, createUserMessage } from "@/lib/conversation-api";
import type { FileUIPart } from "ai";

export default function Home() {
  const router = useRouter();
  const models = useModelCatalog("Text Generation");
  const pendingRef = useRef<{ text: string; files?: FileUIPart[] } | null>(null);
  const inFlightRef = useRef(false);

  const startConversation = async (text: string, files?: FileUIPart[]) => {
    // The create round-trip is over the network; ignore a second submit while
    // it is in flight so it cannot orphan a user-only session.
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    try {
      const sessionId = await createConversation(createUserMessage(text, files));
      router.replace(`/c/${sessionId}?new`);
    } catch (error) {
      inFlightRef.current = false;
      if ((error as Error).message === "Unauthorized") {
        pendingRef.current = { text, files };
        handleUnauthorized();
        return;
      }
      toast.add({ title: "Unable to start a new chat.", type: "error" });
    }
  };

  const { authDialog, handleUnauthorized, resetAuthRetry } = useAuthRetry(() => {
    const pending = pendingRef.current;
    if (pending) {
      pendingRef.current = null;
      void startConversation(pending.text, pending.files);
    }
  });

  const onSendMessage = ({ text, files }: onSendMessageProps) => {
    resetAuthRetry();
    void startConversation(text, files);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="flex flex-col justify-center h-full w-full space-y-4 px-4">
        <div className="font-bold text-2xl mx-auto font-mono">
          <TextEffect per="word" preset="fade-in-blur">
            How can I assist you today?
          </TextEffect>
        </div>
        <ViewTransition name="chat-input">
          <ChatInput models={models} className="mx-auto max-w-3xl" onSendMessage={onSendMessage} />
        </ViewTransition>
      </div>

      <Footer classname="mt-auto mb-1" />
      <AuthDialog {...authDialog} />
    </div>
  );
}
