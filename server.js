const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "sci_j.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  student_name TEXT NOT NULL,
  father_name TEXT,
  mother_name TEXT,
  address TEXT,
  contact TEXT,
  dob TEXT,
  roll_number TEXT NOT NULL,
  class_name TEXT NOT NULL,
  group_name TEXT,
  qualification TEXT,
  board TEXT,
  avatar_data TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  media_data TEXT,
  media_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  data TEXT NOT NULL
);
`);

try {
  db.exec("ALTER TABLE profiles ADD COLUMN avatar_data TEXT");
} catch (e) {
  if (!String(e.message).includes("duplicate column name")) throw e;
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." }
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." }
});

app.use("/api", apiLimiter);
class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.db = database;
    this.getStmt = database.prepare("SELECT data, expires_at FROM sessions WHERE sid=?");
    this.setStmt = database.prepare("INSERT INTO sessions (sid,expires_at,data) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET expires_at=excluded.expires_at,data=excluded.data");
    this.destroyStmt = database.prepare("DELETE FROM sessions WHERE sid=?");
    this.touchStmt = database.prepare("UPDATE sessions SET expires_at=? WHERE sid=?");
  }
  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at && row.expires_at <= Date.now()) {
        this.destroyStmt.run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const maxAge = Number(sess?.cookie?.maxAge) || 24 * 60 * 60 * 1000;
      const expiresAt = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + maxAge;
      this.setStmt.run(sid, expiresAt, JSON.stringify(sess));
      cb(null);
    } catch (e) { cb(e); }
  }
  destroy(sid, cb) {
    try { this.destroyStmt.run(sid); cb(null); } catch (e) { cb(e); }
  }
  touch(sid, sess, cb) {
    try {
      const maxAge = Number(sess?.cookie?.maxAge) || 24 * 60 * 60 * 1000;
      const expiresAt = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + maxAge;
      this.touchStmt.run(expiresAt, sid);
      cb(null);
    } catch (e) { cb(e); }
  }
}

const sessionStore = new SQLiteSessionStore(db);
const cleanupSessions = db.prepare("DELETE FROM sessions WHERE expires_at <= ?");
const sessionCleanupTimer = setInterval(() => cleanupSessions.run(Date.now()), 15 * 60 * 1000);
sessionCleanupTimer.unref();

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || "change-this-secret-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 24 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(__dirname, "public"), {
  etag: true,
  maxAge: "1h"
}));

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Login required." });
  next();
}

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function makeUsername() {
  const row = db.prepare("SELECT COUNT(*) AS count FROM users").get();
  let n = Number(row.count) + 1;
  let username = `DMRC${String(n).padStart(5, "0")}`;
  while (db.prepare("SELECT id FROM users WHERE username=?").get(username)) {
    n++;
    username = `DMRC${String(n).padStart(5, "0")}`;
  }
  return username;
}

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const password = String(req.body.password || "");
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "Password must be 8–128 characters." });
    }

    const username = makeUsername();
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users (username,password_hash) VALUES (?,?)").run(username, hash);

    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: "Could not start secure session." });
      req.session.userId = result.lastInsertRowid;
      req.session.save(saveErr => {
        if (saveErr) return res.status(500).json({ error: "Could not save secure session." });
        res.json({ ok: true, username });
      });
    });
  } catch (e) {
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/login", authLimiter, async (req, res) => {
  try {
    const username = cleanText(req.body.username, 32).toUpperCase();
    const password = String(req.body.password || "");
    const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);

    if (!user || password.length > 128 || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: "Could not start secure session." });
      req.session.userId = user.id;
      req.session.save(saveErr => {
        if (saveErr) return res.status(500).json({ error: "Could not save secure session." });
        res.json({ ok: true, username: user.username });
      });
    });
  } catch (e) {
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/profile/avatar", requireLogin, (req, res) => {
  const avatar = String(req.body.avatar_data || "");
  if (avatar && !/^data:image\/(jpeg|jpg|png|webp);base64,/.test(avatar)) {
    return res.status(400).json({ error: "Invalid profile picture format." });
  }
  if (avatar.length > 1400000) {
    return res.status(400).json({ error: "Profile picture is too large. Please choose a smaller image." });
  }
  db.prepare("UPDATE profiles SET avatar_data=? WHERE user_id=?").run(avatar || null, req.session.userId);
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", requireLogin, (req, res) => {
  const user = db.prepare("SELECT id, username, created_at FROM users WHERE id=?").get(req.session.userId);
  if (!user) return res.status(401).json({ error: "Session expired." });
  const profile = db.prepare("SELECT * FROM profiles WHERE user_id=?").get(req.session.userId);
  res.json({ user, profile: profile || null });
});

app.post("/api/profile", requireLogin, (req, res) => {
  const p = req.body;
  const studentName = cleanText(p.student_name, 100);
  const roll = cleanText(p.roll_number, 40);
  const className = cleanText(p.class_name, 40);
  if (!studentName || !roll || !className) {
    return res.status(400).json({ error: "Student name, roll number and class are required." });
  }

  const values = [
    studentName, cleanText(p.father_name, 100), cleanText(p.mother_name, 100),
    cleanText(p.address, 300), cleanText(p.contact, 40), cleanText(p.dob, 20),
    roll, className, cleanText(p.group_name, 40), cleanText(p.qualification, 100),
    cleanText(p.board, 60)
  ];

  const existing = db.prepare("SELECT id FROM profiles WHERE user_id=?").get(req.session.userId);
  if (existing) {
    db.prepare(`
      UPDATE profiles SET student_name=?, father_name=?, mother_name=?, address=?, contact=?, dob=?,
        roll_number=?, class_name=?, group_name=?, qualification=?, board=?
      WHERE user_id=?
    `).run(...values, req.session.userId);
  } else {
    db.prepare(`
      INSERT INTO profiles
      (user_id,student_name,father_name,mother_name,address,contact,dob,roll_number,class_name,group_name,qualification,board)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(req.session.userId, ...values);
  }

  res.json({ ok: true });
});

const allowedMedia = new Set([
  "image/jpeg","image/jpg","image/png","image/webp","image/gif",
  "video/mp4","video/webm","video/quicktime"
]);

app.post("/api/posts", requireLogin, (req, res) => {
  const body = cleanText(req.body.body, 2000);
  const mediaData = String(req.body.media_data || "");
  const mediaType = cleanText(req.body.media_type, 80);

  if (!body && !mediaData) return res.status(400).json({ error: "Write something or add media first." });
  if (mediaData.length > 11500000) return res.status(413).json({ error: "Media is too large." });
  if (mediaData && !allowedMedia.has(mediaType)) return res.status(400).json({ error: "Unsupported media type." });
  if (mediaData && !/^data:(image|video)\/[a-z0-9.+-]+;base64,/i.test(mediaData)) {
    return res.status(400).json({ error: "Invalid media data." });
  }

  const result = db.prepare(
    "INSERT INTO posts (user_id,body,media_data,media_type) VALUES (?,?,?,?)"
  ).run(req.session.userId, body, mediaData || null, mediaData ? mediaType : null);

  res.json({ ok: true, id: result.lastInsertRowid });
});

app.get("/api/posts", requireLogin, (req, res) => {
  const posts = db.prepare(`
    SELECT posts.id, posts.body, posts.media_data, posts.media_type, posts.created_at,
           users.username, profiles.student_name, profiles.avatar_data
    FROM posts
    JOIN users ON users.id = posts.user_id
    LEFT JOIN profiles ON profiles.user_id = posts.user_id
    ORDER BY posts.id DESC
    LIMIT 100
  `).all();
  res.json(posts);
});

app.listen(PORT, HOST, () => {
  console.log(`SCI J running at http://localhost:${PORT}`);
});