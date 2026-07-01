import { useState, useEffect, useCallback, useRef } from "react";
import "./index.css";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { SessionMonitor } from "./components/SessionMonitor";
import { AuditLogs } from "./components/AuditLogs";
import { Endpoints } from "./components/Endpoints";
import { Usage } from "./components/Usage";
import { LoginPage } from "./components/LoginPage";
import UserManagement from "./components/UserManagement";
import type { Section, Session, Message, User } from "./types";
import { useTranslation } from "./i18n";

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

export function App() {
  const { t } = useTranslation();
  const [section, setSection] = useState<Section>("session-monitor");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string>("");

  // Session monitor state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);

  // Restore session from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem("auth_token");
    const savedUser = localStorage.getItem("user");
    if (savedToken && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser) as User;
        setToken(savedToken);
        setUser(parsedUser);
        // Validate token is still valid
        fetch("/api/auth/me", { headers: authHeaders(savedToken) }).then((res) => {
          if (!res.ok) {
            localStorage.removeItem("auth_token");
            localStorage.removeItem("user");
            setUser(null);
            setToken("");
          }
        });
      } catch {
        localStorage.removeItem("auth_token");
        localStorage.removeItem("user");
      }
      return;
    }
    // Probe for a no-auth backend (single-user / local install via `pulse run`).
    // When PULSE_NO_AUTH=1 on the server, /api/auth/me returns the synthetic
    // admin without any token and we skip the login page entirely.
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((u: User | null) => {
        if (u && typeof u.id === "number") {
          setUser(u);
          setToken("local");
        }
      })
      .catch(() => {});
  }, []);

  // Track whether we've done the initial fetch
  const initialFetchDone = useRef(false);
  // Keep a ref so the polling closure can read the latest activeSessionId
  const activeSessionIdRef = useRef<string>("");

  // Poll sessions every 3 seconds
  useEffect(() => {
    if (!token) return;

    const fetchSessions = () => {
      fetch("/api/sessions", { headers: authHeaders(token) })
        .then((r) => {
          if (r.status === 401) {
            handleLogout();
            return null;
          }
          return r.json();
        })
        .then((data: Session[] | null) => {
          if (!data) return;
          setSessions(data);
          if (!initialFetchDone.current && data.length > 0) {
            // Initial load: select the most recent live session, or the first one
            const live = data.find((s) => s.status === "live");
            const target = live ?? data[0]!;
            setActiveSessionId(target.id);
            activeSessionIdRef.current = target.id;
            initialFetchDone.current = true;
          } else if (initialFetchDone.current) {
            // Auto-follow: if a live session appears that isn't currently selected, switch to it
            const live = data.find((s) => s.status === "live");
            if (live && live.id !== activeSessionIdRef.current) {
              setActiveSessionId(live.id);
              activeSessionIdRef.current = live.id;
            }
          }
        })
        .catch(console.error);
    };

    fetchSessions(); // initial fetch
    const interval = setInterval(fetchSessions, 3000);
    return () => clearInterval(interval);
  }, [token]);

  // Reset initialFetchDone when token changes (logout)
  useEffect(() => {
    if (!token) {
      initialFetchDone.current = false;
      activeSessionIdRef.current = "";
    }
  }, [token]);

  const fetchMessages = useCallback(
    (sessionId: string) => {
      if (!token) return;
      fetch(`/api/sessions/${sessionId}/messages`, { headers: authHeaders(token) })
        .then((r) => r.json())
        .then(setMessages)
        .catch(console.error);
    },
    [token]
  );

  // Poll messages every 2 seconds when viewing a session
  useEffect(() => {
    if (!activeSessionId || !token) return;
    fetchMessages(activeSessionId);
    const interval = setInterval(() => fetchMessages(activeSessionId), 2000);
    return () => clearInterval(interval);
  }, [activeSessionId, fetchMessages, token]);

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    activeSessionIdRef.current = id;
    fetchMessages(id);
  };

  const handleLogin = (loggedInUser: User, authToken: string) => {
    setUser(loggedInUser);
    setToken(authToken);
  };

  const handleLogout = async () => {
    if (token) {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: authHeaders(token),
      }).catch(() => {});
    }
    localStorage.removeItem("auth_token");
    localStorage.removeItem("user");
    setUser(null);
    setToken("");
    setSessions([]);
    setMessages([]);
  };

  const navigate = (s: Section) => {
    setSection(s);
    setSidebarOpen(false);
  };

  const activeCount = sessions.filter((s) => s.status === "live").length;

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const isAdmin = user.role === "admin";

  return (
    <>
      <Sidebar
        activeSection={section}
        onNavigate={navigate}
        sessionCount={activeCount}
        user={user}
        open={sidebarOpen}
        token={token}
      />

      <main className="main">
        <Topbar
          activeSection={section}
          onNavigate={navigate}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          activeSessions={activeCount}
          onLogout={handleLogout}
          token={token}
        />

        <div className="content">
          {section === "session-monitor" && (
            <SessionMonitor
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={handleSelectSession}
              messages={messages}
              token={token}
            />
          )}
          {section === "logs" && <AuditLogs token={token} />}
          {isAdmin && section === "endpoints" && <Endpoints token={token} />}
          {section === "usage" && <Usage token={token} />}
          {isAdmin && section === "users" && (
            <UserManagement token={token} currentUser={user} />
          )}
          {!isAdmin && (section === "endpoints" || section === "users") && (
            <div style={{ padding: "2rem", color: "var(--muted)" }}>{t("app.noAccess")}</div>
          )}
        </div>
      </main>

      <nav className="mobile-nav">
        <button
          className={section === "session-monitor" ? "active" : ""}
          onClick={() => navigate("session-monitor")}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="1" y="1" width="18" height="18" rx="3" />
            <circle cx="10" cy="10" r="2.5" />
          </svg>
          {t("nav.sessionMonitor")}
        </button>
        {isAdmin && (
          <button
            className={section === "endpoints" ? "active" : ""}
            onClick={() => navigate("endpoints")}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="10" cy="10" r="3.5" />
              <path d="M10 1.5v3m0 11v3M1.5 10h3m11 0h3" />
            </svg>
            {t("nav.endpoints")}
          </button>
        )}
        <button
          className={section === "usage" ? "active" : ""}
          onClick={() => navigate("usage")}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="11" width="3" height="7" rx="0.5" />
            <rect x="8.5" y="6" width="3" height="12" rx="0.5" />
          </svg>
          {t("nav.usage")}
        </button>
      </nav>
    </>
  );
}

export default App;
