require("dotenv").config();
const express = require("express");
const path = require("path");
const { notifyP1Online } = require("./mailer");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

/*
  SESSION STATE (IN-MEMORY)
*/
let session = {
  active: false,
  users: {
    p1: false,
    p2: false
  },
  messages: [],
  readIndex: {
    p1: 0,
    p2: 0
  }
};

/*
  HEALTH CHECK
*/
app.get("/", (req, res) => {
  res.send("Service alive");
});

/*
  SECRET WEB INTERFACE
*/
const SECRET_PATH = process.env.SECRET_PATH || "console";
app.get(`/${SECRET_PATH}`, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/*
  START / JOIN SESSION
*/
app.post("/start", (req, res) => {
  const { role } = req.body;

  if (!["p1", "p2"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  // initialize session once
  if (!session.active) {
    session.active = true;
    session.users = { p1: false, p2: false };
    session.messages = [];
    session.readIndex = { p1: 0, p2: 0 };
  }

  // notify p1 when p2 comes online (one-way)
  if (role === "p2" && !session.users.p2) {
    notifyP1Online();
  }

  session.users[role] = true;

  res.json({
    message: "Session started / joined",
    users: session.users
  });
});

/*
  STATE
*/
app.post("/state", (req, res) => {
  if (!session.active) {
    return res.json({ active: false });
  }

  res.json({
    active: true,
    users: session.users
  });
});

/*
  PUSH MESSAGE
*/
app.post("/push", (req, res) => {
  const { role, data } = req.body;

  if (!session.active) {
    return res.status(400).json({ error: "No active session" });
  }

  if (!data || !["p1", "p2"].includes(role)) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const entry = `~${role} ${data}`;
  session.messages.push(entry);

  res.json({ pushed: true });
});

/*
  NOTIFY — SEND CONNECT NOTIFICATION (P2 ONLY)
*/
app.post("/notify", (req, res) => {
  const { role } = req.body;

  if (!session.active) {
    return res.status(400).json({ error: "No active session" });
  }

  // Only P2 can trigger notification
  if (role === "p2") {
    notifyP1Online();
    return res.json({ notified: true, message: "P1 notified" });
  }

  // P1 does nothing
  if (role === "p1") {
    return res.json({ notified: false, message: "P1 takes no action" });
  }

  res.status(400).json({ error: "Invalid role" });
});

/*
  TAIL — ONLY UNREAD (PER USER)
*/
app.get("/tail", (req, res) => {
  const role = req.query.role;

  if (!session.active || !["p1", "p2"].includes(role)) {
    return res.json({ messages: [] });
  }

  const start = session.readIndex[role];
  const unread = session.messages.slice(start);

  session.readIndex[role] = session.messages.length;

  res.json({ messages: unread });
});

/*
  DUMP — FULL SESSION LOG
*/
app.get("/dump", (req, res) => {
  if (!session.active) {
    return res.json({ messages: [] });
  }

  res.json({ messages: session.messages });
});

/*
  DESTROY — CLEAR ALL MESSAGES (KEEP SESSION ACTIVE)
*/
app.post("/destroy", (req, res) => {
  const { role } = req.body;

  if (!session.active) {
    return res.status(400).json({ error: "No active session" });
  }

  if (!["p1", "p2"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  // Clear messages but keep session active
  session.messages = [];
  session.readIndex = { p1: 0, p2: 0 };

  res.json({ destroyed: true, message: "Destroyed", session_active: session.active });
});



/*
  START SERVER
*/
app.listen(PORT, () => {
  console.log(`Service idle and running on port ${PORT}`);
});
