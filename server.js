const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const session = require("express-session");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "sci_j.db");
const db = new Database(DB_PATH);

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
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "change-this-secret-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Login required." });
  next();
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

app.post("/api/register", async (req, res) => {
  try {
    const password = String(req.body.password || "");
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

    const username = makeUsername();
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users (username,password_hash) VALUES (?,?)").run(username, hash);

    req.session.userId = result.lastInsertRowid;
    res.json({ ok: true, username });
  } catch (e) {
    res.status(500).json({ error: "Could not create account." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().toUpperCase();
    const password = String(req.body.password || "");
    const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    req.session.userId = user.id;
    res.json({ ok: true, username: user.username });
  } catch (e) {
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", requireLogin, (req, res) => {
  const user = db.prepare("SELECT id, username, created_at FROM users WHERE id=?").get(req.session.userId);
  const profile = db.prepare("SELECT * FROM profiles WHERE user_id=?").get(req.session.userId);
  res.json({ user, profile: profile || null });
});

app.post("/api/profile", requireLogin, (req, res) => {
  const p = req.body;
  if (!p.student_name || !p.roll_number || !p.class_name) {
    return res.status(400).json({ error: "Student name, roll number and class are required." });
  }

  const existing = db.prepare("SELECT id FROM profiles WHERE user_id=?").get(req.session.userId);
  if (existing) {
    db.prepare(`
      UPDATE profiles SET
        student_name=?, father_name=?, mother_name=?, address=?, contact=?, dob=?,
        roll_number=?, class_name=?, group_name=?, qualification=?, board=?
      WHERE user_id=?
    `).run(
      p.student_name, p.father_name || "", p.mother_name || "", p.address || "",
      p.contact || "", p.dob || "", p.roll_number, p.class_name, p.group_name || "",
      p.qualification || "", p.board || "", req.session.userId
    );
  } else {
    db.prepare(`
      INSERT INTO profiles
      (user_id,student_name,father_name,mother_name,address,contact,dob,roll_number,class_name,group_name,qualification,board)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      req.session.userId, p.student_name, p.father_name || "", p.mother_name || "",
      p.address || "", p.contact || "", p.dob || "", p.roll_number, p.class_name,
      p.group_name || "", p.qualification || "", p.board || ""
    );
  }

  res.json({ ok: true });
});

app.listen(PORT, HOST, () => {
  console.log(`SCI J running at http://localhost:${PORT}`);
});