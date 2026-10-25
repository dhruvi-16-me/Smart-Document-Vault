import { useState } from "react";
import { sendChat } from "../api.ts";
import { ChatPanel } from "../components/ChatPanel.tsx";
import type { ChatMessage } from "../types.ts";

export function ChatPage({ onOpenDocument }: { onOpenDocument: (id: string) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  async function handleSend(message: string, alreadyShown = false) {
    const history = alreadyShown ? messages.slice(0, -1) : messages;
    if (!alreadyShown) {
      setMessages((current) => [...current, { role: "user", content: message }]);
    }
    setPending(true);
    setError(null);
    setRetryMessage(null);
    try {
      const response = await sendChat(message, history);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: response.answer,
          sources: response.sources,
          status: response.status,
        },
      ]);
    } catch (failure) {
      setRetryMessage(message);
      setError(failure instanceof Error ? failure.message : "Could not reach the chat endpoint.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-stone-900">Chat</h2>
        <p className="mt-1 text-sm text-stone-600">
          Ask about your documents. Answers stay on this computer and are not saved after you leave.
        </p>
      </div>
      {error ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-red-700">{error}</p>
          {retryMessage ? (
            <button
              type="button"
              onClick={() => {
                void handleSend(retryMessage, true);
              }}
              className="text-sm underline"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      <ChatPanel
        messages={messages}
        onSend={handleSend}
        onClear={() => {
          setMessages([]);
          setError(null);
          setRetryMessage(null);
        }}
        onOpenDocument={onOpenDocument}
        pending={pending}
      />
    </section>
  );
}
