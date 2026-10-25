import { useEffect, useState } from "react";
import { getHealth } from "./api.ts";
import { ChatPage } from "./pages/ChatPage.tsx";
import { DocumentPage } from "./pages/DocumentPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { SearchPage } from "./pages/SearchPage.tsx";
import { VaultPage } from "./pages/VaultPage.tsx";

type PageId = "vault" | "document" | "profile" | "search" | "chat";

const NAV_ITEMS: { id: PageId; label: string }[] = [
  { id: "vault", label: "Vault" },
  { id: "document", label: "Document" },
  { id: "profile", label: "Profile" },
  { id: "search", label: "Search" },
  { id: "chat", label: "Chat" },
];

export default function App() {
  const [page, setPage] = useState<PageId>("vault");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState("checking");

  useEffect(() => {
    let active = true;
    getHealth()
      .then((response) => {
        if (active) {
          setApiStatus(response.status);
        }
      })
      .catch(() => {
        if (active) {
          setApiStatus("offline");
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function openDocument(id: string) {
    setDocumentId(id);
    setPage("document");
  }

  function handleDocumentDeleted(id: string) {
    if (id === documentId) {
      setDocumentId(null);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
              Local-first
            </p>
            <h1 className="text-lg font-semibold">Document Vault</h1>
          </div>
          <p className="text-sm text-stone-500">API {apiStatus}</p>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-2 px-6 pb-4">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPage(item.id)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                page === item.id
                  ? "bg-stone-900 text-white"
                  : "bg-stone-100 text-stone-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        {page === "vault" ? (
          <VaultPage
            onOpenDocument={openDocument}
            onDocumentDeleted={handleDocumentDeleted}
          />
        ) : null}
        {page === "document" ? <DocumentPage documentId={documentId} /> : null}
        {page === "profile" ? <ProfilePage onOpenDocument={openDocument} /> : null}
        {page === "search" ? <SearchPage onOpenDocument={openDocument} /> : null}
        {page === "chat" ? <ChatPage onOpenDocument={openDocument} /> : null}
      </main>
    </div>
  );
}
