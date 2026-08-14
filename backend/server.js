require("dotenv").config();
const express = require("express");
const path = require("path");
const multer = require("multer");
const { randomBytes } = require("crypto");
const { notifyP1Online } = require("./mailer");
const {
  validateMediaFile,
  uploadEncryptedMediaToCloudinary,
  listEncryptedMediaFromCloudinary,
  deleteEncryptedMediaFromCloudinary
} = require("./mediaStore");

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const PORT = process.env.PORT || 3000;
const MEDIA_TYPES = ["image", "video", "audio"];

function normalizeMessage(role, payload) {
  if (typeof payload === "string") {
    return { type: "text", sender: role, text: payload };
  }

  if (payload && typeof payload === "object") {
    const entry = { ...payload, sender: role };
    if (!entry.type) {
      entry.type = "text";
    }
    if (entry.type === "text" && !entry.text && typeof payload.data === "string") {
      entry.text = payload.data;
    }
    return entry;
  }

  return { type: "text", sender: role, text: String(payload ?? "") };
}

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
  },
  media: {},
  sessionSalt: randomBytes(16).toString("hex")
};

function resetSessionState() {
  session.active = true;
  session.users = { p1: false, p2: false };
  session.messages = [];
  session.readIndex = { p1: 0, p2: 0 };
  // Keep media map so encrypted media can persist across session resets.
  session.media = session.media || {};
  session.sessionSalt = randomBytes(16).toString("hex");
}

async function hydrateMediaFromCloudinary() {
  try {
    const cloudMedia = await listEncryptedMediaFromCloudinary();
    const reconstructed = {};
    for (const item of cloudMedia) {
      reconstructed[item.id] = item;
    }
    session.media = reconstructed;
  } catch (error) {
    console.warn("Media hydrate skipped:", error.message);
  }
}

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
    resetSessionState();
  }

  // notify p1 when p2 comes online (one-way)
  if (role === "p2" && !session.users.p2) {
    notifyP1Online();
  }

  session.users[role] = true;

  hydrateMediaFromCloudinary().finally(() => {
    res.json({
      message: "Session started / joined",
      users: session.users
    });
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

  if (!["p1", "p2"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  if (data === undefined || data === null || data === "") {
    return res.status(400).json({ error: "Empty payload" });
  }

  const entry = normalizeMessage(role, data);
  session.messages.push(entry);

  res.json({ pushed: true, message: entry });
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

  session.messages = [];
  session.readIndex = { p1: 0, p2: 0 };
  session.media = {};

  res.json({ destroyed: true, message: "Destroyed", session_active: session.active });
});

app.get("/media/session-info", (req, res) => {
  if (!session.active) {
    return res.json({ active: false, sessionId: null, sessionSalt: null });
  }

  res.json({
    active: true,
    sessionId: "session-current",
    sessionSalt: session.sessionSalt
  });
});

app.get("/media/list", (req, res) => {
  if (!session.active) {
    return res.json({ items: [] });
  }

  if (!session.media || Object.keys(session.media).length === 0) {
    hydrateMediaFromCloudinary().finally(() => {
      res.json({ items: Object.values(session.media || {}) });
    });
    return;
  }

  res.json({ items: Object.values(session.media) });
});

app.post("/media/upload", upload.single("file"), async (req, res) => {
  try {
    if (!session.active) {
      return res.status(400).json({ error: "No active session" });
    }

    const { mediaType, sender, sessionId, originalName, mimeType } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No encrypted file uploaded." });
    }

    if (!MEDIA_TYPES.includes(mediaType)) {
      return res.status(400).json({ error: "Invalid media type." });
    }

    if (!["p1", "p2"].includes(sender)) {
      return res.status(400).json({ error: "Invalid sender role." });
    }

    const maxSize = { image: 8 * 1024 * 1024, video: 25 * 1024 * 1024, audio: 15 * 1024 * 1024 }[mediaType];
    if (file.size > maxSize) {
      return res.status(400).json({ error: `${mediaType} exceeds the ${Math.round(maxSize / (1024 * 1024))}MB limit.` });
    }

    const asset = await uploadEncryptedMediaToCloudinary(file.buffer, {
      mediaType,
      originalName: originalName || file.originalname,
      sessionId: sessionId || "session",
      sender,
      mimeType: mimeType || file.mimetype || "application/octet-stream"
    });

    const mediaId = asset.public_id;

    const mediaRecord = {
      id: mediaId,
      mediaType,
      sender,
      secureUrl: asset.secure_url,
      publicId: asset.public_id,
      assetId: asset.asset_id,
      originalName: originalName || file.originalname,
      mimeType: mimeType || file.mimetype || "application/octet-stream",
      uploadedAt: new Date().toISOString(),
      size: file.size,
      encrypted: true
    };

    session.media[mediaId] = mediaRecord;

    const messageEntry = {
      type: "media",
      mediaType,
      mediaId,
      sender,
      createdAt: new Date().toISOString(),
      originalName: mediaRecord.originalName,
      mimeType: mediaRecord.mimeType
    };

    session.messages.push(messageEntry);

    res.json({ success: true, media: mediaRecord, message: messageEntry });
  } catch (error) {
    console.error("Media upload failed:", error);
    res.status(500).json({ error: error.message || "Failed to upload encrypted media." });
  }
});

app.delete("/media/:mediaId", async (req, res) => {
  if (!session.active) {
    return res.status(400).json({ error: "No active session" });
  }

  const mediaId = req.params.mediaId;
  let media = session.media[mediaId];

  if (!media) {
    await hydrateMediaFromCloudinary();
    media = session.media[mediaId];
  }

  if (!media) {
    return res.status(404).json({ error: "Media not found." });
  }

  try {
    await deleteEncryptedMediaFromCloudinary(media.publicId);
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete media from Cloudinary." });
  }

  delete session.media[mediaId];
  session.messages = session.messages.filter(m => !(m && m.type === "media" && m.mediaId === mediaId));

  res.json({ success: true, mediaId });
});

app.get("/media/:mediaId", async (req, res) => {
  let media = session.media[req.params.mediaId];

  if (!media) {
    await hydrateMediaFromCloudinary();
    media = session.media[req.params.mediaId];
  }

  if (!media) {
    return res.status(404).json({ error: "Media not found." });
  }

  try {
    const response = await fetch(media.secureUrl);
    if (!response.ok) {
      throw new Error(`Cloudinary fetch failed with status ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.set("Content-Type", media.mimeType || "application/octet-stream");
    res.set("Content-Length", String(buffer.length));
    res.set("Content-Disposition", `inline; filename="${encodeURIComponent(media.originalName || "encrypted-media.bin")}"`);
    res.send(buffer);
  } catch (error) {
    console.error("Media fetch failed:", error);
    res.status(500).json({ error: "Media could not be retrieved from Cloudinary." });
  }
});

/*
  START SERVER
*/
app.listen(PORT, () => {
  console.log(`Service idle and running on port ${PORT}`);
});
