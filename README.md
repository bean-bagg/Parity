# Parity - A Collaborative Code Editor

> **"Code together! Grow faster!"**

Parity provoides a real-time collaborative coding environment where multiple developers can write, run, and chat together — all in the same room, at the same time. Think Google Docs, but built to code, with a built-in compiler, live cursors, and room chat.

---

## Features
### Authentication
- **Sign up / Login** with email and password
- Passwords are hashed with `bcryptjs` before being stored
- Sessions are managed via **JWT tokens** that last 7 days
- Persisted session, so that you stay logged in across page refreshes

---
### Rooms (Workspace)
- **Create** named rooms or **Join** existing ones with the shareable Room ID
- Each room comes with its own editor and chat history
- Sidebar shows the rooms which the user has a current access to
- **Active room info** — Shows the current room name, Room ID (with copy button), active language, and member count

---
### Real-Time Code Editor
- **Fully syncronized** - Every keystroke is broadcasted to all users in the room via WebSockets
- **Auto save** - Code is debounced and saved to the database 1 second after you stop typing
- **Live Cursors** - Tag above each cursor shows the collaborator's username, which shows the current position of other members of room, in the code editor
- **Powered by** - `Monaco Editor` (the VS Code engine)

---
### Code Execution (Run)
- `Stdin` support for inputs before run
- `Stdout` to broadcast the output / Errors in your code
- Languages available - `C++`, `Python`, `JavaScript`
- **Powered by Judge0** — Execution is handled by a self-hosted Judge0 instance (language IDs map as: JavaScript → 63, Python → 71, C++ → 54)

---
### Syncronized Room Chat
- **Real-time communication** - Messages are delivered instantly to all users in the room via WebSockets
- **Persistent chat history** — Messages are saved to MongoDB and loaded when any user opens the room, so the conversation is never lost
- Messages delivered with Timestamps

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, TypeScript |
| Styling | Tailwind CSS |
| Code Editor | Monaco Editor (`@monaco-editor/react`) |
| Real-time | Socket.IO (client + server) |
| Backend | Node.js, Express.js |
| Database | MongoDB (via Mongoose) |
| Auth | JSON Web Tokens (JWT) + bcryptjs |
| Code Execution | Judge0 CE (self-hosted) |

---

## Project Structure

```
Parity/
├── frontend/                        # Next.js application
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx             # Renders <CodeEditor>
│   │   │   ├── layout.tsx
│   │   │   └── globals.css
│   │   └── components/
│   │       └── CodeEditor.tsx       # Entire app UI
│   ├── package.json
│   └── tailwind.config.ts
│
└── backend/                         
    ├── server.js                    # Express + Socket.IO server
    ├── routes/
    │   ├── auth.js                  # POST /api/auth/signup, /login
    │   └── rooms.js                 # GET/POST /api/rooms, GET /api/rooms/:id
    ├── controllers/
    │   └── roomController.js        # Room creation logic
    ├── models/
    │   ├── User.js                  # Mongoose user schema
    │   └── Room.js                  # Mongoose room schema (code, language, messages)
    ├── middleware/
    │   └── authMiddleware.js        # JWT verification for protected routes
    ├── sockets/
    │   └── roomSocket.js            # All real-time logic (cursors, code, chat, execution)
    └── package.json
```

---
## Getting Started

### Prerequisites

Before running Parity locally, make sure you have:

- **Node.js** v18
- **MongoDB** — a local instance or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster
- **Judge0 CE** — running locally on port `2358`. See the [Judge0 setup guide](https://github.com/judge0/judge0/blob/master/CHANGELOG.md) for Docker-based installation.

---

### Step 1 — Clone the repository

```bash
git clone https://github.com/bean-bagg/Parity.git
cd Parity
```

---

### Step 2 — Set up the backend

```bash
cd backend
npm install
```

Create a `.env` file inside the `backend/` folder:

```env
PORT=5001
MONGO_URI= # your MongoDB URI here
JWT_SECRET= # any long string here
CLIENT_URL=http://localhost:3000
```

Start the backend:

```bash
node server.js
# → Server running on port 5001
# → Connected to MongoDB
```

---

### Step 3 — Set up the frontend

```bash
cd frontend
npm install
```

Create a `.env.local` file inside the `frontend/` folder:

```env
NEXT_PUBLIC_API_URL=http://localhost:5001
```

Start the frontend:

```bash
npm run dev
# → Ready on http://localhost:3000
```

Open `http://localhost:3000` in your browser. Sign up for an account, create a room, and start coding.

> To test collaboration, open the same room in a second browser window (then share the Room ID with a friend).

---
