import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ChatMessage, ChatSource } from "../types.ts";

type ChatPanelProps = {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  onClear: () => void;
  onOpenDocument: (id: string) => void;
  pending: boolean;
};

export function ChatPanel({
  messages,
  onSend,
  onClear,
  onOpenDocument,
  pending,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending) {
      return;
    }
    setDraft("");
    onSend(message);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onClear}
          disabled={pending || messages.length === 0}
          className="text-sm text-stone-600 underline disabled:opacity-40"
        >
          Clear conversation
        </button>
      </div>
      <div className="max-h-[32rem] min-h-64 overflow-y-auto rounded-xl border border-stone-200 bg-white p-4">
        {messages.length === 0 ? (
          <p className="text-sm text-stone-500">No messages yet.</p>
        ) : (
          <ul className="space-y-3">
            {messages.map((message, index) => (
              <li
                key={`${message.role}-${index}`}
                className={`max-w-[40rem] rounded-xl px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "ml-auto bg-stone-900 text-white"
                    : "bg-stone-100 text-stone-800"
                }`}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.role === "assistant" && message.sources && message.sources.length > 0 ? (
                  <Sources sources={message.sources} onOpenDocument={onOpenDocument} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {pending ? <p className="mt-3 text-sm text-stone-500">Looking through your documents…</p> : null}
        <div ref={bottom} />
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <label className="sr-only" htmlFor="chat-message">
          Message
        </label>
        <input
          id="chat-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about your documents"
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function Sources({
  sources,
  onOpenDocument,
}: {
  sources: ChatSource[];
  onOpenDocument: (id: string) => void;
}) {
  return (
    <div className="mt-3 border-t border-stone-200 pt-2 text-stone-700">
      <p className="text-xs text-stone-500">
        Retrieved passages. They show where the search looked. They do not prove the answer.
      </p>
      <ul className="mt-2 space-y-2">
        {sources.map((source) => (
          <li key={`${source.document_id}-${source.chunk_id}`}>
            <button
              type="button"
              onClick={() => onOpenDocument(source.document_id)}
              className="text-left underline"
            >
              [{source.label}] {source.filename}
              {source.page_number === null ? "" : `, page ${source.page_number}`}
            </button>
            <p className="mt-1 whitespace-pre-wrap text-xs text-stone-600">{source.snippet}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
