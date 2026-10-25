import { useRef, useState } from "react";
import { streamChat } from "./api.ts";
import type { ChatMessage } from "./types.ts";

export type ChatScope = { id: string; label: string } | null;

/** Conversation state for the chat panel; lives in the app shell so it survives page changes. */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRequest, setLastRequest] = useState<{ text: string; scope: ChatScope } | null>(null);
  const controller = useRef<AbortController | null>(null);

  function updateLast(change: (message: ChatMessage) => ChatMessage) {
    setMessages((current) => [...current.slice(0, -1), change(current[current.length - 1])]);
  }

  async function send(text: string, scope: ChatScope, earlier: ChatMessage[] = messages) {
    const history = earlier.filter((message) => !message.streaming && message.content);
    const abort = new AbortController();
    controller.current = abort;
    setError(null);
    setPending(true);
    setLastRequest({ text, scope });
    setMessages([
      ...earlier,
      { role: "user", content: text, scopeLabel: scope?.label },
      { role: "assistant", content: "", streaming: true },
    ]);
    try {
      await streamChat(
        text,
        history,
        scope?.id ?? null,
        {
          onSources: (sources) => updateLast((message) => ({ ...message, sources })),
          onToken: (token) =>
            updateLast((message) => ({ ...message, content: message.content + token })),
          onDone: (answer, status) =>
            updateLast((message) => ({ ...message, content: answer, status, streaming: false })),
        },
        abort.signal,
      );
    } catch (failure) {
      if (abort.signal.aborted) {
        updateLast((message) => ({ ...message, streaming: false, status: "stopped" }));
      } else {
        // Drop the unanswered pair so a retry starts clean.
        setMessages((current) => current.slice(0, -2));
        setError(failure instanceof Error ? failure.message : "Could not reach the assistant.");
      }
    } finally {
      setPending(false);
      controller.current = null;
    }
  }

  function retry() {
    if (lastRequest) {
      void send(lastRequest.text, lastRequest.scope);
    }
  }

  function stop() {
    controller.current?.abort();
  }

  function clear() {
    stop();
    setMessages([]);
    setError(null);
  }

  return { messages, pending, error, send, retry, stop, clear };
}

export type ChatController = ReturnType<typeof useChat>;
