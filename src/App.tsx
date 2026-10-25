import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getHealth } from "./api.ts";
import { ChatPanel } from "./components/ChatPanel.tsx";
import { ChatIcon, HomeIcon, ProfileIcon, SearchIcon, VaultIcon } from "./components/icons.tsx";
import { DocumentPage } from "./pages/DocumentPage.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { SearchPage } from "./pages/SearchPage.tsx";
import { VaultPage } from "./pages/VaultPage.tsx";
import { useChat } from "./useChat.ts";
import type { ChatScope } from "./useChat.ts";

type PageId = "home" | "vault" | "document" | "profile" | "search";

const NAV_ITEMS: { id: PageId; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", icon: <HomeIcon size={20} /> },
  { id: "vault", label: "Vault", icon: <VaultIcon size={20} /> },
  { id: "search", label: "Search", icon: <SearchIcon size={20} /> },
  { id: "profile", label: "Profile", icon: <ProfileIcon size={20} /> },
];

// The chat panel sits beside the page from this width; below it, it slides over the page.
const DOCKED_PANEL_QUERY = "(min-width: 1280px)";

export default function App() {
  const [page, setPage] = useState<PageId>("home");
  // The category the vault opens filtered to, and a counter so re-opening re-applies it.
  const [vaultFilter, setVaultFilter] = useState<{ group: string | null; at: number }>({
    group: null,
    at: 0,
  });
  const [documentId, setDocumentId] = useState<string | null>(null);
  // Changes on every open so the same page can be focused twice in a row.
  const [focus, setFocus] = useState<{ page: number; at: number } | null>(null);
  const [currentDocument, setCurrentDocument] = useState<ChatScope>(null);
  const [apiStatus, setApiStatus] = useState<"checking" | "ok" | "offline">("checking");
  const [chatOpen, setChatOpen] = useState(() => window.matchMedia(DOCKED_PANEL_QUERY).matches);
  const [scopeToDocument, setScopeToDocument] = useState(true);
  const chat = useChat();

  useEffect(() => {
    let active = true;
    getHealth()
      .then(() => active && setApiStatus("ok"))
      .catch(() => active && setApiStatus("offline"));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!chatOpen) {
      return;
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setChatOpen(false);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [chatOpen]);

  function openDocument(id: string, pageNumber: number | null = null) {
    if (id !== documentId) {
      setScopeToDocument(true);
    }
    setDocumentId(id);
    setFocus(pageNumber ? { page: pageNumber, at: Date.now() } : null);
    setPage("document");
  }

  function openSource(id: string, pageNumber: number | null) {
    openDocument(id, pageNumber);
    if (!window.matchMedia(DOCKED_PANEL_QUERY).matches) {
      setChatOpen(false);
    }
  }

  function openVault(group: string | null) {
    setVaultFilter({ group, at: Date.now() });
    setPage("vault");
  }

  function askAboutDocument() {
    setScopeToDocument(true);
    setChatOpen(true);
  }

  function handleDocumentDeleted(id: string) {
    if (id === documentId) {
      setDocumentId(null);
      setCurrentDocument(null);
    }
  }

  const activeNav = page === "document" ? "vault" : page;
  const chatDocument = page === "document" ? currentDocument : null;

  return (
    <div className="flex h-screen overflow-hidden">
      <nav
        aria-label="Main"
        className="flex w-16 shrink-0 flex-col bg-navy-900 text-white md:w-60"
      >
        <div className="flex items-center gap-3 px-3 py-5 md:px-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white shadow-sm">
            <VaultIcon size={22} />
          </span>
          <div className="hidden md:block">
            <p className="font-semibold leading-tight text-white">Document Vault</p>
            <p className="text-xs text-navy-300">Private, on this computer</p>
          </div>
        </div>
        <ul className="flex flex-col gap-1 px-2 md:px-3">
          {NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => (item.id === "vault" ? openVault(null) : setPage(item.id))}
                aria-current={activeNav === item.id ? "page" : undefined}
                className={`relative flex w-full items-center justify-center gap-3 rounded-lg px-3 py-2.5 font-medium transition-colors focus-visible:outline-brand-400 md:justify-start ${
                  activeNav === item.id
                    ? "bg-white/10 text-white before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-brand-400"
                    : "text-navy-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                {item.icon}
                <span className="hidden md:inline">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="px-2 pt-4 md:px-3">
          <button
            type="button"
            onClick={() => setChatOpen((current) => !current)}
            aria-expanded={chatOpen}
            className={`flex w-full items-center justify-center gap-3 rounded-lg px-3 py-2.5 font-medium transition-colors focus-visible:outline-brand-400 md:justify-start ${
              chatOpen ? "bg-white text-navy-900" : "bg-brand-600 text-white hover:bg-brand-700"
            }`}
          >
            <ChatIcon size={20} />
            <span className="hidden md:inline">Ask your vault</span>
          </button>
        </div>
        <div className="mt-auto px-3 py-4 md:px-5">
          <ApiStatus status={apiStatus} />
        </div>
      </nav>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 pt-8 pb-28 lg:px-10">
          {page === "home" ? <HomePage onOpenDocument={openDocument} onOpenVault={openVault} /> : null}
          {page === "vault" ? (
            <VaultPage
              key={vaultFilter.at}
              initialGroup={vaultFilter.group}
              onOpenDocument={openDocument}
              onDocumentDeleted={handleDocumentDeleted}
            />
          ) : null}
          {page === "document" && documentId ? (
            <DocumentPage
              key={documentId}
              documentId={documentId}
              focus={focus}
              onBack={() => setPage("vault")}
              onAsk={askAboutDocument}
              onLoaded={(record) => setCurrentDocument({ id: record.id, label: record.filename })}
            />
          ) : null}
          {page === "profile" ? <ProfilePage onOpenDocument={openDocument} /> : null}
          {page === "search" ? <SearchPage onOpenDocument={openDocument} /> : null}
        </div>
      </main>

      {chatOpen ? (
        <div
          className="fixed inset-0 z-30 bg-stone-900/30 xl:hidden"
          onClick={() => setChatOpen(false)}
          aria-hidden="true"
        />
      ) : null}
      <div
        inert={!chatOpen}
        className={`fixed inset-y-0 right-0 z-40 w-full max-w-[420px] border-l border-stone-200 transition-transform duration-200 xl:static xl:z-auto xl:w-[400px] ${
          chatOpen ? "translate-x-0 shadow-2xl xl:shadow-none" : "invisible translate-x-full xl:hidden"
        }`}
      >
        <ChatPanel
          chat={chat}
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          currentDocument={chatDocument}
          scopeToDocument={scopeToDocument}
          onScopeChange={setScopeToDocument}
          onOpenSource={openSource}
        />
      </div>

      {!chatOpen ? (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="fixed right-6 bottom-6 z-20 flex items-center gap-2 rounded-full bg-brand-600 px-5 py-3 font-medium text-white shadow-lg hover:bg-brand-700"
        >
          <ChatIcon size={20} />
          Ask
        </button>
      ) : null}
    </div>
  );
}

function ApiStatus({ status }: { status: "checking" | "ok" | "offline" }) {
  const label = { checking: "Connecting…", ok: "Connected", offline: "Backend offline" }[status];
  const dot = { checking: "bg-navy-300", ok: "bg-emerald-400", offline: "bg-red-400" }[status];
  return (
    <p className="flex items-center justify-center gap-2 text-xs text-navy-300 md:justify-start" title={label}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="hidden md:inline">{label}</span>
    </p>
  );
}
