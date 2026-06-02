"use client";

import Editor, { OnMount } from "@monaco-editor/react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

type User = {
  id: string;
  username: string;
  email: string;
};

type Room = {
  _id: string;
  name: string;
  createdBy?: { _id?: string; username?: string } | string;
  messages?: ChatMessage[];
  code?: string;
  language?: Language;
  createdAt?: string;
};

type ChatMessage = {
  username: string;
  text: string;
  timestamp?: string;
};

type PresenceUser = {
  socketId: string;
  userId: string;
  username: string;
  color: string;
};

type CursorPosition = {
  lineNumber: number;
  column: number;
};

type RemoteCursor = {
  userId: string;
  username: string;
  color: string;
  cursor: CursorPosition;
};

type Language = "javascript" | "python" | "cpp";
type AuthMode = "login" | "signup";
type RoomTab = "joined" | "create" | "join";
type DockTab = "console" | "chat" | "members" | "you";
type EditorInstance = Parameters<OnMount>[0];
type MonacoInstance = Parameters<OnMount>[1];

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";
const STORAGE_KEY = "parity.session";

const LANGUAGES: Record<Language, { label: string; judgeId: number; starter: string; icon: string }> = {
  javascript: {
    label: "JavaScript",
    judgeId: 63,
    icon: "JS",
    starter: "const input = require('fs').readFileSync(0, 'utf8').trim();\nconsole.log('Hello from Parity');",
  },
  python: {
    label: "Python",
    judgeId: 71,
    icon: "PY",
    starter: "import sys\ninput_data = sys.stdin.read().strip()\nprint('Hello from Parity')",
  },
  cpp: {
    label: "C++",
    judgeId: 54,
    icon: "C++",
    starter:
      "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    cout << \"Hello from Parity\" << endl;\n    return 0;\n}",
  },
};

const LANG_COLORS: Record<Language, string> = {
  javascript: "#facc15",
  python: "#5eead4",
  cpp: "#a78bfa",
};

const accentCards = [
  { title: "Live cursors", copy: "See teammates exactly where they're editing in real time.", color: "#5eead4", icon: "⟶" },
  { title: "Room chat", copy: "Messages scoped to every room, persisted across sessions.", color: "#facc15", icon: "⌨" },
  { title: "Run panel", copy: "Full stdin/stdout console beside your editor.", color: "#a78bfa", icon: "▶" },
];

function ParityLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="relative grid h-10 w-10 place-items-center rounded-xl border border-[#5eead4]/30 bg-gradient-to-br from-[#0d1f2d] to-[#061018] shadow-[0_0_24px_rgba(94,234,212,0.22)]"
        style={{ fontFamily: "monospace" }}
      >
        <span
          style={{
            fontSize: compact ? "18px" : "20px",
            lineHeight: 1,
            display: "block",
            transform: "rotate(0deg)",
            userSelect: "none",
          }}
        >
          🌐
        </span>
      </div>
      {!compact && (
        <div>
          <p
            style={{ fontFamily: "'Courier New', monospace" }}
            className="text-xs font-black uppercase tracking-[0.3em] text-[#5eead4]"
          >
            Parity
          </p>
          <p className="text-[11px] font-semibold text-[#8fa2c7]">Collaborative compiler</p>
        </div>
      )}
    </div>
  );
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span className="relative flex h-2 w-2">
      {online && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#5eead4] opacity-60" />
      )}
      <span
        className={`relative inline-flex h-2 w-2 rounded-full ${online ? "bg-[#5eead4]" : "bg-[#facc15]"}`}
      />
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      className="ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-[#5eead4] border border-[#5eead4]/30 hover:bg-[#5eead4]/10 transition"
      title="Copy Room ID"
    >
      {copied ? "✓" : "copy"}
    </button>
  );
}

export default function CodeEditor() {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [roomTab, setRoomTab] = useState<RoomTab>("joined");
  const [dockTab, setDockTab] = useState<DockTab>("console");
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [roomName, setRoomName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [code, setCode] = useState(LANGUAGES.javascript.starter);
  const [language, setLanguage] = useState<Language>("javascript");
  const [stdin, setStdin] = useState("");
  const [output, setOutput] = useState("Run code to see output here.");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [status, setStatus] = useState("Connect to begin.");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [currentUserColor, setCurrentUserColor] = useState("#5eead4");
  const socketRef = useRef<Socket | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  const userColorRef = useRef("#5eead4");
  const activeRoomRef = useRef<Room | null>(null);
  const userRef = useRef<User | null>(null);
  const editorRef = useRef<EditorInstance | null>(null);
  const monacoRef = useRef<MonacoInstance | null>(null);
  const cursorDecorationIdsRef = useRef<Map<string, string[]>>(new Map());
  const cursorStyleIdsRef = useRef<Set<string>>(new Set());
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    }),
    [token],
  );

  const selectedRoomCreator = useMemo(() => {
    if (!activeRoom?.createdBy) return "Unknown";
    return typeof activeRoom.createdBy === "string" ? "Creator" : activeRoom.createdBy.username ?? "Creator";
  }, [activeRoom]);

  const uniquePresence = useMemo(() => {
    const members = new Map<string, PresenceUser>();
    for (const member of presence) members.set(member.userId, member);
    return Array.from(members.values());
  }, [presence]);

  useEffect(() => {
    if (dockTab === "chat") chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, dockTab]);

  const clearRemoteCursors = useCallback((allowedUserIds?: Set<string>) => {
    const editor = editorRef.current;
    if (!editor) return;
    for (const [userId, ids] of Array.from(cursorDecorationIdsRef.current.entries())) {
      if (!allowedUserIds || !allowedUserIds.has(userId)) {
        editor.deltaDecorations(ids, []);
        cursorDecorationIdsRef.current.delete(userId);
      }
    }
  }, []);

  const paintRemoteCursor = useCallback((payload: RemoteCursor) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const currentUser = userRef.current;
    if (!editor || !monaco || !currentUser || payload.userId === currentUser.id) return;

    const safeId = payload.userId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const styleId = `remote-cursor-style-${safeId}`;
    const safeName = payload.username.replace(/["\\]/g, "");

    if (!cursorStyleIdsRef.current.has(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .remote-cursor-${safeId} {
          border-left: 2px solid ${payload.color};
          margin-left: -1px;
          pointer-events: none;
        }
        .remote-cursor-label-${safeId}::before {
          content: "${safeName}";
          background: ${payload.color};
          color: #020617;
          border-radius: 3px 3px 3px 0;
          font: 700 10px/1 'Courier New', monospace;
          padding: 2px 5px;
          position: absolute;
          top: -18px;
          left: -1px;
          white-space: nowrap;
          z-index: 100;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
        }
        .remote-cursor-label-${safeId} {
          position: relative;
          pointer-events: none;
        }
      `;
      document.head.appendChild(style);
      cursorStyleIdsRef.current.add(styleId);
    }

    const model = editor.getModel();
    const lineNumber = Math.max(
      1,
      Math.min(payload.cursor.lineNumber, model?.getLineCount() ?? payload.cursor.lineNumber),
    );
    const column = Math.max(
      1,
      Math.min(payload.cursor.column, model?.getLineMaxColumn(lineNumber) ?? payload.cursor.column),
    );
    const previous = cursorDecorationIdsRef.current.get(payload.userId) ?? [];
    const next = editor.deltaDecorations(previous, [
      {
        range: new monaco.Range(lineNumber, column, lineNumber, column),
        options: {
          className: `remote-cursor-${safeId}`,
          beforeContentClassName: `remote-cursor-label-${safeId}`,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          zIndex: 10,
        },
      },
    ]);

    cursorDecorationIdsRef.current.set(payload.userId, next);
  }, []);

  const fetchRooms = useCallback(async () => {
    if (!token) return;
    const response = await fetch(`${API_URL}/api/rooms`, { headers });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Failed to fetch rooms");
    setRooms(data);
  }, [headers, token]);

  const joinRoom = useCallback(
    async (room: Room) => {
      if (!token || !user) return;
      setError("");
      setActiveRoom(room);
      activeRoomRef.current = room;
      activeRoomIdRef.current = room._id;
      setStatus(`Opened — ${room.name}`);

      const response = await fetch(`${API_URL}/api/rooms/${room._id}`, { headers });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to open room");

      const loadedRoom: Room = data.room;
      setActiveRoom(loadedRoom);
      activeRoomRef.current = loadedRoom;
      setMessages(data.messages ?? loadedRoom.messages ?? []);
      setCode(loadedRoom.code || LANGUAGES[loadedRoom.language ?? "javascript"].starter);
      setLanguage((loadedRoom.language ?? "javascript") as Language);
      setOutput("Room loaded. Run code when you are ready.");
      setPresence([]);
      setDockTab("console");
      setRoomTab("joined");
      clearRemoteCursors();

      socketRef.current?.emit("join_room", {
        roomId: room._id,
        userId: user.id,
        username: user.username,
      });
    },
    [clearRemoteCursors, headers, token, user],
  );

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const session = JSON.parse(raw) as { token?: string; user?: User };
      if (session.token && session.user) {
        setToken(session.token);
        setUser(session.user);
        setStatus(`Welcome back, ${session.user.username}.`);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchRooms().catch((err: Error) => setError(err.message));
  }, [fetchRooms, token]);

  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);
  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => {
    if (!token || !user) return;
    const socket = io(API_URL, { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      setStatus("Realtime connection ready.");
      if (activeRoomIdRef.current) {
        socket.emit("join_room", {
          roomId: activeRoomIdRef.current,
          userId: user.id,
          username: user.username,
        });
      }
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
      setStatus("Realtime connection paused.");
    });

    socket.on("load_initial_state", (payload: { code?: string; language?: Language; messages?: ChatMessage[] }) => {
      setCode(payload.code || LANGUAGES[payload.language ?? "javascript"].starter);
      setLanguage((payload.language ?? "javascript") as Language);
      setMessages(payload.messages ?? []);
      setLastSavedAt(new Date());
    });

    socket.on("user_joined", (payload: { userId: string; color: string; users: PresenceUser[] }) => {
      const currentUser = payload.users?.find((member) => member.userId === user.id);
      const assignedColor = currentUser?.color || (payload.userId === user.id ? payload.color : userColorRef.current);
      userColorRef.current = assignedColor;
      setCurrentUserColor(assignedColor);
      setPresence(payload.users ?? []);
    });

    socket.on("user_left", (payload: { users: PresenceUser[] }) => {
      const users = payload.users ?? [];
      setPresence(users);
      clearRemoteCursors(new Set(users.map((m) => m.userId)));
    });
    socket.on("cursor_update", (payload: RemoteCursor) => paintRemoteCursor(payload));
    socket.on("code_update", (payload: { code: string }) => {
      setCode(payload.code);
      setLastSavedAt(new Date());
    });
    socket.on("language_updated", (payload: { language: Language }) => setLanguage(payload.language));
    socket.on("receive_message", (message: ChatMessage) => setMessages((c) => [...c, message]));
    socket.on("execution_result", (payload: { output: string }) => {
      setOutput(payload.output);
      setIsRunning(false);
      setDockTab("console");
    });
    socket.on("room_error", (payload: { message: string }) => setError(payload.message));

    return () => {
      clearRemoteCursors();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [clearRemoteCursors, paintRemoteCursor, token, user]);

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      const endpoint = authMode === "login" ? "login" : "signup";
      const body = authMode === "login" ? { email, password } : { username, email, password };
      const response = await fetch(`${API_URL}/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Authentication failed");
      setToken(data.token);
      setUser(data.user);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setStatus(`Signed in as ${data.user.username}.`);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  const createRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!roomName.trim()) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/rooms`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: roomName.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to create room");
      setRoomName("");
      setRooms((c) => (c.some((r) => r._id === data._id) ? c : [data, ...c]));
      await joinRoom(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create room");
    } finally {
      setIsLoading(false);
    }
  };

  const joinRoomById = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const roomId = joinRoomId.trim();
    if (!roomId) return;
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/rooms/${roomId}`, { headers });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Room not found");
      const room = data.room as Room;
      setRooms((c) => (c.some((r) => r._id === room._id) ? c : [room, ...c]));
      setJoinRoomId("");
      await joinRoom(room);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to join room");
    } finally {
      setIsLoading(false);
    }
  };

  const onCodeChange = (value?: string) => {
    const nextCode = value ?? "";
    setCode(nextCode);
    if (!activeRoom || !socketRef.current) return;
    socketRef.current.emit("code_change", { roomId: activeRoom._id, code: nextCode });
    setLastSavedAt(new Date());
  };

  const onLanguageChange = (nextLanguage: Language) => {
    setLanguage(nextLanguage);
    if (!activeRoom || !socketRef.current) return;
    socketRef.current.emit("language_change", { roomId: activeRoom._id, language: nextLanguage });
  };

  const runCode = () => {
    if (!activeRoom || !socketRef.current) return;
    setIsRunning(true);
    setDockTab("console");
    setOutput("Running...");
    socketRef.current.emit("run_code", {
      roomId: activeRoom._id,
      code,
      input: stdin,
      language_id: LANGUAGES[language].judgeId,
    });
  };

  const sendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeRoom || !user || !messageText.trim() || !socketRef.current) return;
    socketRef.current.emit("send_message", {
      roomId: activeRoom._id,
      username: user.username,
      text: messageText.trim(),
    });
    setMessageText("");
  };

  const onEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.onDidChangeCursorPosition((event) => {
      const currentRoom = activeRoomRef.current;
      const currentUser = userRef.current;
      if (!currentRoom || !currentUser || !socketRef.current) return;
      socketRef.current.emit("cursor_move", {
        roomId: currentRoom._id,
        userId: currentUser.id,
        username: currentUser.username,
        color: userColorRef.current,
        cursor: event.position,
      });
    });
  };

  const logout = () => {
    socketRef.current?.disconnect();
    window.localStorage.removeItem(STORAGE_KEY);
    setToken("");
    setUser(null);
    setRooms([]);
    setActiveRoom(null);
    setPresence([]);
    setMessages([]);
    setCurrentUserColor("#5eead4");
    userColorRef.current = "#5eead4";
    setStatus("Signed out.");
  };

  if (!user || !token) {
    return (
      <section className="min-h-screen overflow-hidden bg-[#030712] text-[#e5ecff]">
        <div className="pointer-events-none fixed inset-0 z-0">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_15%_15%,rgba(94,234,212,0.12),transparent_40%),radial-gradient(ellipse_at_85%_80%,rgba(250,204,21,0.08),transparent_40%)]" />
          <div
            className="absolute inset-0 opacity-[0.035]"
            style={{
              backgroundImage:
                "linear-gradient(#5eead4 1px, transparent 1px), linear-gradient(90deg, #5eead4 1px, transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />
        </div>

        <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col justify-between px-8 py-10 sm:px-14 lg:px-20">
            <ParityLogo />

            <div className="my-16 max-w-2xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#1f2a44] bg-[#0b1220]/80 px-4 py-1.5">
                <StatusDot online />
                <span className="font-mono text-[11px] font-bold text-[#5eead4] tracking-widest uppercase">
                  realtime · rooms · chat · run
                </span>
              </div>
              <h1
                className="text-5xl font-black leading-[1.04] text-white sm:text-6xl xl:text-7xl"
                style={{ fontFamily: "'Courier New', Courier New" }}
              >
                Code together!<br />
                <span className="text-[#5eead4]">Grow faster!</span>
              </h1>
              <p className="mt-5 max-w-xl text-base font-semibold leading-7 text-[#a7b4cf]">
                Every room with its own editor, live cursor layer, chat history, stdin/stdout console, and multi-language runtime.
                A shared Experience!
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {accentCards.map((card) => (
                <div
                  key={card.title}
                  className="rounded-xl border border-[#1f2a44] bg-[#0b1220]/70 p-5 backdrop-blur-sm transition hover:border-[#263653]"
                  style={{ boxShadow: `0 0 0 0 ${card.color}` }}
                >
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-1 w-8 rounded-full" style={{ backgroundColor: card.color }} />
                    <span className="text-base" style={{ color: card.color }}>{card.icon}</span>
                  </div>
                  <p className="text-sm font-black text-white">{card.title}</p>
                  <p className="mt-1.5 text-xs leading-5 text-[#8fa2c7]">{card.copy}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center border-l border-[#1f2a44] bg-[#07101f]/80 px-6 py-10 backdrop-blur-sm">
            <div className="w-full max-w-md">
              <div className="mb-6 grid grid-cols-2 rounded-xl border border-[#1f2a44] bg-[#050c18] p-1">
                {(["login", "signup"] as AuthMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAuthMode(mode)}
                    className={`rounded-lg px-4 py-2.5 text-sm font-black capitalize transition-all duration-200 ${
                      authMode === mode
                        ? "bg-[#5eead4] text-[#061018] shadow-[0_0_18px_rgba(94,234,212,0.3)]"
                        : "text-[#8fa2c7] hover:text-white"
                    }`}
                  >
                    {mode === "login" ? "Sign in" : "Sign up"}
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-[#1f2a44] bg-[#0b1220]/90 p-7 shadow-2xl backdrop-blur-sm">
                <h2
                  className="text-2xl font-black text-white"
                  style={{ fontFamily: "'Courier New', monospace" }}
                >
                  {authMode === "login" ? "Welcome back ;)" : "Join the session"}
                </h2>
                <p className="mt-1.5 text-sm text-[#8fa2c7]">
                  {authMode === "login"
                    ? "Sign in to access your rooms, chat history, and saved code."
                    : "Create an account to start collaborating."}
                </p>

                <form onSubmit={submitAuth} className="mt-6 space-y-4">
                  {authMode === "signup" && (
                    <div>
                      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#7dd3fc]">
                        Username
                      </label>
                      <input
                        className="w-full rounded-lg border border-[#263653] bg-[#050816] px-3.5 py-3 text-white outline-none transition placeholder:text-[#374151] focus:border-[#5eead4] focus:shadow-[0_0_0_2px_rgba(94,234,212,0.15)]"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        placeholder="your_handle"
                        autoComplete="username"
                      />
                    </div>
                  )}
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#7dd3fc]">
                      Email
                    </label>
                    <input
                      className="w-full rounded-lg border border-[#263653] bg-[#050816] px-3.5 py-3 text-white outline-none transition placeholder:text-[#374151] focus:border-[#5eead4] focus:shadow-[0_0_0_2px_rgba(94,234,212,0.15)]"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#7dd3fc]">
                      Password
                    </label>
                    <input
                      className="w-full rounded-lg border border-[#263653] bg-[#050816] px-3.5 py-3 text-white outline-none transition placeholder:text-[#374151] focus:border-[#5eead4] focus:shadow-[0_0_0_2px_rgba(94,234,212,0.15)]"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      autoComplete={authMode === "login" ? "current-password" : "new-password"}
                    />
                  </div>

                  {error && (
                    <div className="rounded-lg border border-[#7f1d1d] bg-[#2a1117] px-4 py-3 text-sm text-[#fca5a5]">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="mt-2 w-full rounded-lg bg-[#facc15] px-4 py-3 font-black text-[#08111f] transition hover:bg-[#fde047] hover:shadow-[0_0_24px_rgba(250,204,21,0.35)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isLoading ? "Working..." : authMode === "login" ? "Sign in →" : "Create account →"}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const dockTabs: { id: DockTab; label: string }[] = [
    { id: "console", label: "Console" },
    { id: "chat", label: "Chat" },
    { id: "members", label: "Members" },
    { id: "you", label: "You" },
  ];

  return (
    <main className="flex h-screen min-h-[720px] flex-col overflow-hidden bg-[#050816] text-[#e5ecff]">
      <header className="flex shrink-0 items-center justify-between border-b border-[#1a2538] bg-[#08111f]/95 px-4 py-2.5 shadow-[0_1px_0_rgba(94,234,212,0.06)] backdrop-blur-md">
        <div className="flex items-center gap-3">
          <ParityLogo compact />
          <div className="h-5 w-px bg-[#1f2a44]" />
          <div className="flex items-center gap-2">
            <StatusDot online={isConnected} />
            <span className="text-xs font-semibold text-[#8fa2c7]">{status}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeRoom && (
            <div className="hidden items-center gap-1.5 rounded-lg border border-[#1f2a44] bg-[#0b1220] px-3 py-1.5 sm:flex">
              <span className="text-xs text-[#52627f]">room</span>
              <span className="font-mono text-xs font-bold text-[#5eead4]">{activeRoom.name}</span>
            </div>
          )}
          <div
            className="flex items-center gap-2 rounded-lg border border-[#1f2a44] bg-[#0b1220] px-3 py-1.5 cursor-pointer hover:border-[#263653] transition"
            onClick={() => setDockTab("you")}
            title="View your profile"
          >
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black text-[#061018]"
              style={{ backgroundColor: currentUserColor }}
            >
              {user.username[0].toUpperCase()}
            </span>
            <span className="text-xs font-bold text-[#dbeafe]">{user.username}</span>
          </div>
          <button
            onClick={logout}
            className="rounded-lg border border-[#1f2a44] px-3 py-1.5 text-xs font-bold text-[#8fa2c7] transition hover:border-[#263653] hover:text-white"
          >
            Sign out
          </button>
        </div>
      </header>

      {error && (
        <div className="mx-3 mt-2 shrink-0 flex items-center justify-between rounded-lg border border-[#7f1d1d] bg-[#2a1117] px-4 py-2.5 text-sm text-[#fca5a5]">
          <span>{error}</span>
          <button onClick={() => setError("")} className="ml-3 text-[#fca5a5] hover:text-white font-black">✕</button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[280px_minmax(0,1fr)_360px]">

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#1a2538] bg-[#08111f] shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <div className="border-b border-[#1a2538] p-2">
            <div className="grid grid-cols-3 rounded-lg border border-[#1f2a44] bg-[#050c18] p-0.5">
              {(["joined", "create", "join"] as RoomTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setRoomTab(tab)}
                  className={`rounded-md py-2 text-xs font-black capitalize transition-all ${
                    roomTab === tab
                      ? "bg-[#1a2f47] text-[#5eead4] shadow-[0_0_12px_rgba(94,234,212,0.12)]"
                      : "text-[#52627f] hover:text-[#8fa2c7]"
                  }`}
                >
                  {tab === "joined" ? "Rooms" : tab === "create" ? "New" : "Join"}
                </button>
              ))}
            </div>
          </div>

          {roomTab === "joined" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-[#1a2538] px-4 py-3">
                <h2 className="text-sm font-black text-white">Your Rooms</h2>
                <p className="mt-0.5 text-[11px] text-[#52627f]">{rooms.length} room{rooms.length !== 1 ? "s" : ""} accessible</p>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2 space-y-1">
                {rooms.length === 0 && (
                  <div className="p-4 text-center">
                    <p className="text-sm text-[#52627f]">No rooms yet.</p>
                    <p className="mt-1 text-xs text-[#374151]">Create or join one to get started.</p>
                  </div>
                )}
                {rooms.map((room) => {
                  const active = activeRoom?._id === room._id;
                  const creator = typeof room.createdBy === "string" ? null : room.createdBy?.username;
                  return (
                    <button
                      key={room._id}
                      onClick={() => joinRoom(room).catch((err: Error) => setError(err.message))}
                      className={`w-full rounded-lg border p-3 text-left transition-all ${
                        active
                          ? "border-[#5eead4]/40 bg-[#0f2535] shadow-[0_0_16px_rgba(94,234,212,0.1)]"
                          : "border-transparent hover:border-[#1f2a44] hover:bg-[#0d1828]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {active && <span className="h-1.5 w-1.5 rounded-full bg-[#5eead4] shadow-[0_0_6px_#5eead4]" />}
                        <span className="block truncate text-sm font-black text-white">{room.name}</span>
                      </div>
                      {creator && (
                        <span className="mt-0.5 block text-[11px] text-[#52627f]">by {creator}</span>
                      )}
                      <span className="mt-1 block truncate font-mono text-[10px] text-[#374151]">{room._id}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {roomTab === "create" && (
            <form onSubmit={createRoom} className="space-y-4 p-4">
              <div>
                <h2 className="text-sm font-black text-white">Create Room</h2>
                <p className="mt-1 text-[11px] leading-5 text-[#52627f]">
                  A new room opens immediately and gets a shareable ID.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#7dd3fc]">
                  Room name
                </label>
                <input
                  className="w-full rounded-lg border border-[#263653] bg-[#050816] px-3.5 py-3 text-sm text-white outline-none placeholder:text-[#374151] focus:border-[#5eead4]"
                  placeholder="e.g. Team Debugging"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                />
              </div>
              <button
                className="w-full rounded-lg bg-[#5eead4] px-4 py-3 text-sm font-black text-[#061018] transition hover:bg-[#7ff5e2] hover:shadow-[0_0_20px_rgba(94,234,212,0.3)] disabled:opacity-60"
                disabled={isLoading || !roomName.trim()}
              >
                {isLoading ? "Creating..." : "Create & Open →"}
              </button>
            </form>
          )}

          {roomTab === "join" && (
            <form onSubmit={joinRoomById} className="space-y-4 p-4">
              <div>
                <h2 className="text-sm font-black text-white">Join by ID</h2>
                <p className="mt-1 text-[11px] leading-5 text-[#52627f]">
                  Paste the room ID shared by a collaborator.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[#7dd3fc]">
                  Room ID
                </label>
                <input
                  className="w-full rounded-lg border border-[#263653] bg-[#050816] px-3.5 py-3 font-mono text-xs text-white outline-none placeholder:text-[#374151] focus:border-[#facc15]"
                  placeholder="65f3a..."
                  value={joinRoomId}
                  onChange={(e) => setJoinRoomId(e.target.value)}
                />
              </div>
              <button
                className="w-full rounded-lg bg-[#facc15] px-4 py-3 text-sm font-black text-[#08111f] transition hover:bg-[#fde047] hover:shadow-[0_0_20px_rgba(250,204,21,0.3)] disabled:opacity-60"
                disabled={isLoading || !joinRoomId.trim()}
              >
                {isLoading ? "Joining..." : "Join Room →"}
              </button>
            </form>
          )}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[#1a2538] bg-[#08111f] shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#1a2538] px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="truncate text-base font-black text-white">
                  {activeRoom?.name ?? <span className="text-[#374151]">No room selected</span>}
                </h2>
                {activeRoom && (
                  <span className="rounded-md border border-[#1f2a44] bg-[#050c18] px-2 py-0.5 text-[10px] font-semibold text-[#52627f]">
                    by {selectedRoomCreator}
                  </span>
                )}
              </div>
              {activeRoom?._id && (
                <div className="mt-1 flex items-center gap-1 flex-wrap">
                  <span className="font-mono text-[10px] text-[#374151]">ID:</span>
                  <span className="font-mono text-[10px] text-[#5eead4]/70">{activeRoom._id}</span>
                  <CopyButton text={activeRoom._id} />
                  {lastSavedAt && (
                    <span className="ml-2 text-[10px] text-[#374151]">
                      · saved {lastSavedAt.toLocaleTimeString()}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-lg border border-[#1f2a44] bg-[#050c18] p-1">
                {(Object.entries(LANGUAGES) as [Language, (typeof LANGUAGES)[Language]][]).map(([lang, details]) => (
                  <button
                    key={lang}
                    onClick={() => onLanguageChange(lang)}
                    disabled={!activeRoom}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-black transition-all disabled:cursor-not-allowed ${
                      language === lang
                        ? "shadow-[0_0_10px_currentColor]"
                        : "text-[#52627f] hover:text-[#8fa2c7]"
                    }`}
                    style={language === lang ? { backgroundColor: LANG_COLORS[lang] + "22", color: LANG_COLORS[lang] } : {}}
                  >
                    {details.icon}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setCode(LANGUAGES[language].starter)}
                disabled={!activeRoom}
                className="rounded-lg border border-[#1f2a44] px-3 py-2 text-xs font-bold text-[#8fa2c7] transition hover:border-[#263653] hover:text-white disabled:opacity-40"
                title="Reset to starter code"
              >
                Reset
              </button>

              <button
                onClick={runCode}
                disabled={!activeRoom || isRunning}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-black transition-all ${
                  isRunning
                    ? "bg-[#facc15]/50 text-[#08111f]/60 cursor-not-allowed"
                    : "bg-[#facc15] text-[#08111f] hover:bg-[#fde047] hover:shadow-[0_0_20px_rgba(250,204,21,0.35)]"
                } disabled:opacity-60`}
              >
                {isRunning ? (
                  <>
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#08111f]/30 border-t-[#08111f]" />
                    Running
                  </>
                ) : (
                  <>▶ Run</>
                )}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            {activeRoom ? (
              <Editor
                height="100%"
                theme="vs-dark"
                language={language === "cpp" ? "cpp" : language}
                value={code}
                onChange={onCodeChange}
                onMount={onEditorMount}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  fontFamily: "'Courier New', Consolas, monospace",
                  padding: { top: 16, bottom: 16 },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  lineHeight: 22,
                  cursorBlinking: "smooth",
                  smoothScrolling: true,
                  renderLineHighlight: "line",
                  overviewRulerBorder: false,
                  hideCursorInOverviewRuler: true,
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center p-8">
                <div
                  className="text-6xl select-none"
                  style={{ fontFamily: "monospace", transform: "rotate(90deg)" }}
                >
                  ;)
                </div>
                <p className="text-lg font-black text-[#374151]">No room selected</p>
                <p className="text-sm text-[#263653]">
                  Create a new room or join one by ID from the left panel.
                </p>
              </div>
            )}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[#1a2538] bg-[#08111f] shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <div className="grid shrink-0 grid-cols-4 border-b border-[#1a2538] bg-[#050c18] p-1 gap-0.5">
            {dockTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setDockTab(tab.id)}
                className={`relative rounded-md py-2 text-xs font-black transition-all ${
                  dockTab === tab.id
                    ? "bg-[#1a2f47] text-[#5eead4]"
                    : "text-[#52627f] hover:text-[#8fa2c7]"
                }`}
              >
                {tab.label}
                {tab.id === "chat" && messages.length > 0 && dockTab !== "chat" && activeRoom && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#facc15]" />
                )}
              </button>
            ))}
          </div>

          {dockTab === "console" && (
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(140px,0.38fr)_minmax(200px,0.62fr)]">
              <div className="flex min-h-0 flex-col border-b border-[#1a2538]">
                <div className="flex items-center gap-2 border-b border-[#1a2538] bg-[#050c18] px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-[#7dd3fc]" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#7dd3fc]">Stdin</span>
                </div>
                <textarea
                  className="min-h-0 flex-1 resize-none bg-[#07101f] p-3 font-mono text-xs text-[#e5ecff] outline-none placeholder:text-[#374151]"
                  value={stdin}
                  onChange={(e) => setStdin(e.target.value)}
                  placeholder="Provide stdin input here..."
                  spellCheck={false}
                />
              </div>
              <div className="flex min-h-0 flex-col">
                <div className="flex items-center gap-2 border-b border-[#1a2538] bg-[#050c18] px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-[#5eead4]" />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#5eead4]">Output</span>
                  {isRunning && (
                    <span className="ml-auto flex items-center gap-1.5 text-[10px] text-[#facc15]">
                      <span className="h-1.5 w-1.5 animate-ping rounded-full bg-[#facc15]" />
                      Running
                    </span>
                  )}
                </div>
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap bg-[#020617] p-3 font-mono text-xs leading-6 text-[#e5ecff]">
                  {output}
                </pre>
              </div>
            </div>
          )}

          {dockTab === "chat" && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-[#1a2538] px-4 py-3">
                <h2 className="text-sm font-black text-white">
                  {activeRoom ? activeRoom.name : "Room Chat"}
                </h2>
                <p className="mt-0.5 text-[11px] text-[#52627f]">
                  {activeRoom ? `${messages.length} message${messages.length !== 1 ? "s" : ""}` : "Open a room to chat"}
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3 space-y-2">
                {messages.length === 0 && (
                  <p className="pt-4 text-center text-xs text-[#374151]">No messages yet. Say hello!</p>
                )}
                {messages.map((msg, i) => {
                  const isMe = msg.username === user.username;
                  return (
                    <div
                      key={`${msg.username}-${msg.timestamp ?? i}`}
                      className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                    >
                      <div className={`max-w-[85%] rounded-xl px-3 py-2 ${
                        isMe
                          ? "rounded-br-sm bg-[#0f2535] border border-[#5eead4]/20"
                          : "rounded-bl-sm bg-[#0d1828] border border-[#1f2a44]"
                      }`}>
                        <div className="mb-1 flex items-center gap-2">
                          <span className={`text-[11px] font-black ${isMe ? "text-[#5eead4]" : "text-[#7dd3fc]"}`}>
                            {isMe ? "You" : msg.username}
                          </span>
                          <span className="text-[10px] text-[#ccd3dd]">
                            {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "now"}
                          </span>
                        </div>
                        <p className="break-words text-xs leading-5 text-[#dbeafe]">{msg.text}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={chatBottomRef} />
              </div>
              <form onSubmit={sendMessage} className="flex shrink-0 gap-2 border-t border-[#1a2538] p-2.5">
                <input
                  className="min-w-0 flex-1 rounded-lg border border-[#1f2a44] bg-[#050c18] px-3 py-2 text-xs text-white outline-none placeholder:text-[#374151] focus:border-[#5eead4] disabled:opacity-40"
                  placeholder={activeRoom ? "Message this room..." : "Choose a room first"}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  disabled={!activeRoom}
                />
                <button
                  className="rounded-lg bg-[#5eead4] px-3 py-2 text-xs font-black text-[#061018] transition hover:bg-[#7ff5e2] disabled:opacity-40"
                  disabled={!activeRoom || !messageText.trim()}
                >
                  ↑
                </button>
              </form>
            </div>
          )}

          {dockTab === "members" && (
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="border-b border-[#1a2538] px-4 py-3">
                <h2 className="text-sm font-black text-white">Members</h2>
                <p className="mt-0.5 text-[11px] text-[#52627f]">
                  {uniquePresence.length} user{uniquePresence.length !== 1 ? "s" : ""} in this room
                </p>
              </div>
              <div className="p-3 space-y-1.5">
                {uniquePresence.length === 0 && (
                  <p className="pt-4 text-center text-xs text-[#374151]">Open a room to see collaborators.</p>
                )}
                {uniquePresence.map((member) => {
                  const isCurrentUser = member.userId === user.id;
                  return (
                    <div
                      key={member.userId}
                      className="flex items-center gap-3 rounded-lg border border-[#1a2538] bg-[#0d1828] p-3 transition hover:border-[#1f2a44]"
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black text-[#061018] shadow-[0_0_12px_currentColor]"
                        style={{ backgroundColor: member.color, color: member.color.includes("ea") ? "#061018" : "#fff" }}
                      >
                        <span style={{ color: "#061018" }}>{member.username[0].toUpperCase()}</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black" style={{ color: member.color }}>
                          {member.username}
                          {isCurrentUser && <span className="ml-1.5 text-[10px] font-bold text-[#52627f]">(you)</span>}
                        </p>
                        <p className="text-[10px] text-[#374151]">
                          {isCurrentUser ? "Active — that's you" : "Active collaborator"}
                        </p>
                      </div>
                      <span
                        className="h-2 w-2 rounded-full shadow-[0_0_6px_currentColor]"
                        style={{ backgroundColor: member.color, color: member.color }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {dockTab === "you" && (
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <h2 className="text-sm font-black text-white">Your Profile</h2>
              <p className="mt-0.5 text-[11px] text-[#52627f]">Your session info and preferences.</p>

              <div className="mt-4 rounded-xl border border-[#1a2538] bg-[#0d1828] p-4">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-xl font-black shadow-[0_0_20px_currentColor]"
                    style={{ backgroundColor: currentUserColor + "33", color: currentUserColor, border: `2px solid ${currentUserColor}44` }}
                  >
                    {user.username[0].toUpperCase()}
                  </span>
                  <div>
                    <p className="font-black text-white">{user.username}</p>
                    <p className="text-xs text-[#52627f]">{user.email}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-[#050c18] p-2.5">
                    <p className="text-[#52627f]">Cursor color</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full shadow-[0_0_6px_currentColor]"
                        style={{ backgroundColor: currentUserColor, color: currentUserColor }}
                      />
                      <span className="font-mono font-bold text-white">{currentUserColor}</span>
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#050c18] p-2.5">
                    <p className="text-[#52627f]">Rooms joined</p>
                    <p className="mt-1.5 font-black text-white">{rooms.length}</p>
                  </div>
                </div>
              </div>

              {activeRoom && (
                <div className="mt-3 rounded-xl border border-[#1a2538] bg-[#0d1828] p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#52627f]">Active Room</p>
                  <p className="mt-2 font-black text-white">{activeRoom.name}</p>
                  <p className="mt-0.5 text-[11px] text-[#52627f]">Created by {selectedRoomCreator}</p>
                  <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-[#050c18] px-2 py-1.5">
                    <span className="font-mono text-[10px] text-[#5eead4]/60 truncate">{activeRoom._id}</span>
                    <CopyButton text={activeRoom._id} />
                  </div>
                  <p className="mt-2 text-[11px] text-[#52627f]">
                    Language: <span className="font-bold" style={{ color: LANG_COLORS[language] }}>{LANGUAGES[language].label}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-[#52627f]">
                    {uniquePresence.length} member{uniquePresence.length !== 1 ? "s" : ""} present
                  </p>
                </div>
              )}

              <div className="mt-3 rounded-xl border border-[#1a2538] bg-[#0d1828] p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#52627f]">Connection</p>
                <div className="mt-2 flex items-center gap-2">
                  <StatusDot online={isConnected} />
                  <span className={`text-sm font-bold ${isConnected ? "text-[#5eead4]" : "text-[#facc15]"}`}>
                    {isConnected ? "Realtime online" : "Realtime offline"}
                  </span>
                </div>
                {lastSavedAt && (
                  <p className="mt-1.5 text-[11px] text-[#52627f]">
                    Last sync: {lastSavedAt.toLocaleTimeString()}
                  </p>
                )}
              </div>

              <button
                onClick={logout}
                className="mt-4 w-full rounded-lg border border-[#7f1d1d] bg-[#2a1117]/60 py-2.5 text-sm font-black text-[#fca5a5] transition hover:bg-[#2a1117] hover:shadow-[0_0_16px_rgba(252,165,165,0.12)]"
              >
                Sign out
              </button>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
