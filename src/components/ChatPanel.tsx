import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import type { ChatSource } from "../types.ts";
import type { ChatController, ChatScope } from "../useChat.ts";
import { ChatIcon, CloseIcon, SendIcon, ShieldIcon, StopIcon } from "./icons.tsx";
import { Button } from "./ui.tsx";

type ChatPanelProps = {
  chat: ChatController;
  open: boolean;
  onClose: () => void;
  // The document open on the page, if any; questions can be limited to it.
  currentDocument: ChatScope;
  scopeToDocument: boolean;
  onScopeChange: (toDocument: boolean) => void;
  onOpenSource: (documentId: string, page: number | null) => void;
};

const SUGGESTIONS_FOR_DOCUMENT = [
  "Summarise this document",
  "What are the important dates?",
  "Whose name appears on it?",
];
const SUGGESTIONS_FOR_VAULT = [
  "What is my date of birth?",
  "Which documents mention my address?",
  "What is my Class 12 percentage?",
];

export function ChatPanel({
  chat,
  open,
  onClose,
  currentDocument,
  scopeToDocument,
  onScopeChange,
  onOpenSource,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const scope = scopeToDocument ? currentDocument : null;

  useEffect(() => {
    if (open) {
      input.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [chat.messages]);

  function submit(text: string) {
    const message = text.trim();
    if (!message || chat.pending) {
      return;
    }
    setDraft("");
    void chat.send(message, scope);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit(draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(draft);
    }
  }

  const suggestions = scope ? SUGGESTIONS_FOR_DOCUMENT : SUGGESTIONS_FOR_VAULT;

  return (
    <aside aria-label="Chat with your vault" className="flex h-full flex-col bg-white">
      <header className="flex items-start justify-between gap-3 border-b border-stone-200 px-5 py-4">
        <div>
          <h2 className="font-semibold text-stone-900">Ask your vault</h2>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-stone-600">
            <ShieldIcon size={14} /> Answers are generated on this computer
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={chat.clear}
            disabled={chat.messages.length === 0}
          >
            Clear
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close chat">
            <CloseIcon />
          </Button>
        </div>
      </header>

      {currentDocument ? (
        <div className="border-b border-stone-200 px-5 py-3">
          <div className="grid grid-cols-2 rounded-lg bg-stone-100 p-1 text-sm" role="radiogroup" aria-label="Search in">
            <ScopeOption checked={scopeToDocument} onSelect={() => onScopeChange(true)}>
              This document
            </ScopeOption>
            <ScopeOption checked={!scopeToDocument} onSelect={() => onScopeChange(false)}>
              All documents
            </ScopeOption>
          </div>
          {scopeToDocument ? (
            <p className="mt-2 truncate text-xs text-stone-600">Searching only {currentDocument.label}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {chat.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
              <ChatIcon size={24} />
            </span>
            <p className="font-medium text-stone-800">
              {scope ? "Ask about this document" : "Ask about your documents"}
            </p>
            <p className="mt-1 text-sm text-stone-600">Answers come only from your files, with sources.</p>
            <div className="mt-5 flex flex-col gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => submit(suggestion)}
                  className="rounded-full border border-stone-200 bg-white px-4 py-1.5 text-sm text-stone-700 hover:border-brand-300 hover:bg-brand-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-4">
            {chat.messages.map((message, index) =>
              message.role === "user" ? (
                <li key={index} className="flex flex-col items-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-white shadow-sm">
                    {message.content}
                  </p>
                  {message.scopeLabel ? (
                    <span className="mt-1 max-w-[85%] truncate text-xs text-stone-500">
                      About {message.scopeLabel}
                    </span>
                  ) : null}
                </li>
              ) : (
                <li key={index} className="max-w-[92%]">
                  <div className="rounded-2xl rounded-bl-md border border-brand-100 bg-cream px-4 py-2.5 text-stone-800">
                    {message.content ? (
                      <p className="whitespace-pre-wrap">
                        {message.content}
                        {message.streaming ? (
                          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-brand-600 align-middle" />
                        ) : null}
                      </p>
                    ) : (
                      <p className="text-sm text-stone-600">Searching your documents…</p>
                    )}
                    {message.status === "stopped" ? (
                      <p className="mt-1 text-xs text-stone-600">Stopped.</p>
                    ) : null}
                  </div>
                  {message.sources && message.sources.length > 0 ? (
                    <Sources sources={message.sources} onOpenSource={onOpenSource} />
                  ) : null}
                </li>
              ),
            )}
          </ul>
        )}
        {chat.error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p>{chat.error}</p>
            <button type="button" onClick={chat.retry} className="mt-1 font-medium underline">
              Try again
            </button>
          </div>
        ) : null}
        <div ref={bottom} />
      </div>

      <form onSubmit={handleSubmit} className="border-t border-stone-200 p-4">
        <div className="flex items-end gap-2 rounded-2xl border border-stone-300 bg-white p-2 shadow-sm focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20">
          <label className="sr-only" htmlFor="chat-message">
            Message
          </label>
          <textarea
            id="chat-message"
            ref={input}
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={scope ? "Ask about this document…" : "Ask about your documents…"}
            className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-stone-900 placeholder:text-stone-500 focus:outline-none"
          />
          {chat.pending ? (
            <Button variant="secondary" size="sm" onClick={chat.stop} aria-label="Stop answering">
              <StopIcon size={16} />
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="sm" disabled={!draft.trim()} aria-label="Send">
              <SendIcon size={16} />
            </Button>
          )}
        </div>
        <p className="mt-2 text-center text-xs text-stone-500">Enter to send · Shift + Enter for a new line</p>
      </form>
    </aside>
  );
}

function ScopeOption({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
        checked ? "bg-white text-brand-700 shadow-sm" : "text-stone-600 hover:text-stone-900"
      }`}
    >
      {children}
    </button>
  );
}

function Sources({
  sources,
  onOpenSource,
}: {
  sources: ChatSource[];
  onOpenSource: (documentId: string, page: number | null) => void;
}) {
  return (
    <div className="mt-2">
      <p className="text-xs text-stone-500">Where it looked</p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {sources.map((source) => (
          <button
            key={`${source.document_id}-${source.chunk_id}`}
            type="button"
            title={source.snippet}
            onClick={() => onOpenSource(source.document_id, source.page_number)}
            className="max-w-full truncate rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-600 hover:border-brand-300 hover:text-brand-700"
          >
            [{source.label}] {source.filename}
            {source.page_number === null ? "" : ` · p. ${source.page_number}`}
          </button>
        ))}
      </div>
    </div>
  );
}
