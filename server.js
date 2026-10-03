const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const USE_POSTGRES = process.env.USE_POSTGRES === "true" && Boolean(process.env.DATABASE_URL);
let db;
let pool;
let backupPool;

function qmarks(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => "$" + (++i));
}

async function dbGet(sql, params = []) {
  if (USE_POSTGRES) return (await pool.query(qmarks(sql), params)).rows[0] || null;
  return db.prepare(sql).get(...params) || null;
}
async function dbAll(sql, params = []) {
  if (USE_POSTGRES) return (await pool.query(qmarks(sql), params)).rows;
  return db.prepare(sql).all(...params);
}
async function dbRun(sql, params = []) {
  if (USE_POSTGRES) return (await pool.query(qmarks(sql), params)).rowCount;
  return db.prepare(sql).run(...params).changes;
}

async function initBackupDatabase() {
  const url = process.env.BACKUP_DATABASE_URL;
  if (!url) return;
  backupPool = new Pool({
    connectionString: url,
    max: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
  });
  await backupPool.query("SELECT 1");
  await backupPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id BIGINT PRIMARY KEY,
      user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      student_name TEXT NOT NULL,
      father_name TEXT, mother_name TEXT, address TEXT, contact TEXT, dob TEXT,
      roll_number TEXT NOT NULL, class_name TEXT NOT NULL, group_name TEXT,
      qualification TEXT, board TEXT, avatar_data TEXT
    );
    CREATE TABLE IF NOT EXISTS posts (
      id BIGINT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '', media_data TEXT, media_type TEXT,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_backup_posts_created_at ON posts(created_at DESC);
  `);
  console.log("Database backup: Render Postgres");
}

async function restoreSqliteFromBackup() {
  if (!backupPool || !db) return;
  const localCount = Number(db.prepare("SELECT COUNT(*) AS count FROM users").get()?.count || 0);
  if (localCount) return;
  const remoteCount = Number((await backupPool.query("SELECT COUNT(*)::int AS count FROM users")).rows[0]?.count || 0);
  if (!remoteCount) return;
  console.log("Restoring SQLite from Render Postgres backup...");
  const users = (await backupPool.query("SELECT id,username,password_hash,created_at FROM users ORDER BY id")).rows;
  const profiles = (await backupPool.query("SELECT id,user_id,student_name,father_name,mother_name,address,contact,dob,roll_number,class_name,group_name,qualification,board,avatar_data FROM profiles ORDER BY id")).rows;
  const posts = (await backupPool.query("SELECT id,user_id,body,media_data,media_type,created_at FROM posts ORDER BY id")).rows;
  const tx = db.transaction(() => {
    const u = db.prepare("INSERT OR REPLACE INTO users (id,username,password_hash,created_at) VALUES (?,?,?,?)");
    const p = db.prepare("INSERT OR REPLACE INTO profiles (id,user_id,student_name,father_name,mother_name,address,contact,dob,roll_number,class_name,group_name,qualification,board,avatar_data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const po = db.prepare("INSERT OR REPLACE INTO posts (id,user_id,body,media_data,media_type,created_at) VALUES (?,?,?,?,?,?)");
    for (const x of users) u.run(x.id,x.username,x.password_hash,x.created_at);
    for (const x of profiles) p.run(x.id,x.user_id,x.student_name,x.father_name,x.mother_name,x.address,x.contact,x.dob,x.roll_number,x.class_name,x.group_name,x.qualification,x.board,x.avatar_data);
    for (const x of posts) po.run(x.id,x.user_id,x.body,x.media_data,x.media_type,x.created_at);
  });
  tx();
}

async function syncSqliteBackup() {
  if (!backupPool || !db) return;
  try {
    const users = db.prepare("SELECT id,username,password_hash,created_at FROM users ORDER BY id").all();
    const profiles = db.prepare("SELECT id,user_id,student_name,father_name,mother_name,address,contact,dob,roll_number,class_name,group_name,qualification,board,avatar_data FROM profiles ORDER BY id").all();
    const posts = db.prepare("SELECT id,user_id,body,media_data,media_type,created_at FROM posts ORDER BY id").all();
    await backupPool.query("BEGIN");
    for (const u of users) {
      await backupPool.query(`
        INSERT INTO users (id,username,password_hash,created_at) VALUES ($1,$2,$3,$4)
        ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,password_hash=EXCLUDED.password_hash,created_at=EXCLUDED.created_at
      `, [u.id,u.username,u.password_hash,u.created_at]);
    }
    for (const p of profiles) {
      await backupPool.query(`
        INSERT INTO profiles (id,user_id,student_name,father_name,mother_name,address,contact,dob,roll_number,class_name,group_name,qualification,board,avatar_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,student_name=EXCLUDED.student_name,father_name=EXCLUDED.father_name,mother_name=EXCLUDED.mother_name,address=EXCLUDED.address,contact=EXCLUDED.contact,dob=EXCLUDED.dob,roll_number=EXCLUDED.roll_number,class_name=EXCLUDED.class_name,group_name=EXCLUDED.group_name,qualification=EXCLUDED.qualification,board=EXCLUDED.board,avatar_data=EXCLUDED.avatar_data
      `, [p.id,p.user_id,p.student_name,p.father_name,p.mother_name,p.address,p.contact,p.dob,p.roll_number,p.class_name,p.group_name,p.qualification,p.board,p.avatar_data]);
    }
    for (const p of posts) {
      await backupPool.query(`
        INSERT INTO posts (id,user_id,body,media_data,media_type,created_at) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,body=EXCLUDED.body,media_data=EXCLUDED.media_data,media_type=EXCLUDED.media_type,created_at=EXCLUDED.created_at
      `, [p.id,p.user_id,p.body,p.media_data,p.media_type,p.created_at]);
    }
    await backupPool.query("SELECT setval(pg_get_serial_sequence('users','id'), COALESCE((SELECT MAX(id) FROM users),1), true)");
    await backupPool.query("SELECT setval(pg_get_serial_sequence('profiles','id'), COALESCE((SELECT MAX(id) FROM profiles),1), true)");
    await backupPool.query("SELECT setval(pg_get_serial_sequence('posts','id'), COALESCE((SELECT MAX(id) FROM posts),1), true)");
    await backupPool.query("COMMIT");
  } catch (e) {
    try { await backupPool.query("ROLLBACK"); } catch {}
    console.error("backup sync", e.message);
  }
}

async function initDatabase() {
  if (USE_POSTGRES) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
    });
    await pool.query("SELECT 1");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS profiles (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        student_name TEXT NOT NULL,
        father_name TEXT, mother_name TEXT, address TEXT, contact TEXT, dob TEXT,
        roll_number TEXT NOT NULL, class_name TEXT NOT NULL, group_name TEXT,
        qualification TEXT, board TEXT, avatar_data TEXT
      );
      CREATE TABLE IF NOT EXISTS posts (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL DEFAULT '',
        media_data TEXT, media_type TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        expires_at BIGINT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    `);
    console.log("Database: Render Postgres");
    return;
  }

  const DB_PATH = process.env.DB_PATH || path.join(__dirname, "sci_j.db");
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
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
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  `);
  try { db.exec("ALTER TABLE profiles ADD COLUMN avatar_data TEXT"); } catch (e) {
    if (!String(e.message).includes("duplicate column name")) throw e;
  }
  console.log("Database: SQLite fallback");
}

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
    this.getStmt = database.prepare("SELECT data, expires_at FROM sessions WHERE sid=?");
    this.setStmt = database.prepare("INSERT INTO sessions (sid,expires_at,data) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET expires_at=excluded.expires_at,data=excluded.data");
    this.destroyStmt = database.prepare("DELETE FROM sessions WHERE sid=?");
    this.touchStmt = database.prepare("UPDATE sessions SET expires_at=? WHERE sid=?");
  }
  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at <= Date.now()) { this.destroyStmt.run(sid); return cb(null, null); }
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const expiresAt = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + (Number(sess?.cookie?.maxAge) || 86400000);
      this.setStmt.run(sid, expiresAt, JSON.stringify(sess)); cb(null);
    } catch (e) { cb(e); }
  }
  destroy(sid, cb) { try { this.destroyStmt.run(sid); cb(null); } catch (e) { cb(e); } }
  touch(sid, sess, cb) {
    try {
      const expiresAt = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + (Number(sess?.cookie?.maxAge) || 86400000);
      this.touchStmt.run(expiresAt, sid); cb(null);
    } catch (e) { cb(e); }
  }
}

class PostgresSessionStore extends session.Store {
  get(sid, cb) {
    dbGet("SELECT data,expires_at FROM sessions WHERE sid=?",[sid]).then(async row => {
      if (!row) return cb(null,null);
      if (Number(row.expires_at) <= Date.now()) { await dbRun("DELETE FROM sessions WHERE sid=?",[sid]); return cb(null,null); }
      cb(null,JSON.parse(row.data));
    }).catch(cb);
  }
  set(sid,sess,cb) {
    const expiresAt=sess?.cookie?.expires?new Date(sess.cookie.expires).getTime():Date.now()+(Number(sess?.cookie?.maxAge)||86400000);
    dbRun("INSERT INTO sessions (sid,expires_at,data) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET expires_at=excluded.expires_at,data=excluded.data",[sid,expiresAt,JSON.stringify(sess)]).then(()=>cb(null)).catch(cb);
  }
  destroy(sid,cb) { dbRun("DELETE FROM sessions WHERE sid=?",[sid]).then(()=>cb(null)).catch(cb); }
  touch(sid,sess,cb) {
    const expiresAt=sess?.cookie?.expires?new Date(sess.cookie.expires).getTime():Date.now()+(Number(sess?.cookie?.maxAge)||86400000);
    dbRun("UPDATE sessions SET expires_at=? WHERE sid=?",[expiresAt,sid]).then(()=>cb(null)).catch(cb);
  }
}

function makeStore() { return USE_POSTGRES ? new PostgresSessionStore() : new SQLiteSessionStore(db); }
function requireLogin(req,res,next) { if (!req.session.userId) return res.status(401).json({error:"Login required."}); next(); }
function cleanText(value,max) { return String(value ?? "").trim().slice(0,max); }

async function makeUsername() {
  const row=await dbGet("SELECT COUNT(*) AS count FROM users");
  let n=Number(row?.count||0)+1, username="DMRC"+String(n).padStart(5,"0");
  while(await dbGet("SELECT id FROM users WHERE username=?",[username])) { n++; username="DMRC"+String(n).padStart(5,"0"); }
  return username;
}

async function start() {
  await initDatabase();
  await initBackupDatabase().catch(err=>console.error("backup init",err.message));
  if (backupPool && db) { await restoreSqliteFromBackup(); await syncSqliteBackup(); }

  app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false}));
  app.use(express.json({limit:"12mb"}));
  app.use(express.urlencoded({extended:true,limit:"1mb"}));

  const authLimiter=rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:"draft-8",legacyHeaders:false,message:{error:"Too many login attempts. Please try again later."}});
  const apiLimiter=rateLimit({windowMs:60*1000,limit:120,standardHeaders:"draft-8",legacyHeaders:false,message:{error:"Too many requests. Please slow down."}});
  app.use("/api",apiLimiter);

  app.use(session({
    store:makeStore(),
    secret:process.env.SESSION_SECRET || "change-this-secret-in-production",
    resave:false,saveUninitialized:false,
    cookie:{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",maxAge:86400000}
  }));
  app.use(express.static(path.join(__dirname,"public"),{etag:true,maxAge:"1h"}));

  app.get("/healthz",(req,res)=>res.json({ok:true,database:USE_POSTGRES?"postgres":"sqlite",backup:Boolean(backupPool)}));

  app.post("/api/register",authLimiter,async(req,res)=>{
    try{
      const password=String(req.body.password||"");
      if(password.length<8||password.length>128)return res.status(400).json({error:"Password must be 8–128 characters."});
      const username=await makeUsername(),hash=await bcrypt.hash(password,12);
      const user=await dbGet("INSERT INTO users (username,password_hash) VALUES (?,?) RETURNING id,username",[username,hash]);
      req.session.regenerate(err=>{
        if(err)return res.status(500).json({error:"Could not start secure session."});
        req.session.userId=user.id;
        req.session.save(saveErr=>saveErr?res.status(500).json({error:"Could not save secure session."}):res.json({ok:true,username}));
      });
    }catch(e){console.error("register",e);res.status(500).json({error:"Could not create account."});}
  });

  app.post("/api/login",authLimiter,async(req,res)=>{
    try{
      const username=cleanText(req.body.username,32).toUpperCase(),password=String(req.body.password||"");
      const user=await dbGet("SELECT * FROM users WHERE username=?",[username]);
      if(!user||password.length>128||!(await bcrypt.compare(password,user.password_hash)))return res.status(401).json({error:"Invalid username or password."});
      req.session.regenerate(err=>{
        if(err)return res.status(500).json({error:"Could not start secure session."});
        req.session.userId=user.id;
        req.session.save(saveErr=>saveErr?res.status(500).json({error:"Could not save secure session."}):res.json({ok:true,username:user.username}));
      });
    }catch(e){console.error("login",e);res.status(500).json({error:"Login failed."});}
  });

  app.post("/api/profile/avatar",requireLogin,async(req,res)=>{
    const avatar=String(req.body.avatar_data||"");
    if(avatar&&!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(avatar))return res.status(400).json({error:"Invalid profile picture format."});
    if(avatar.length>1400000)return res.status(400).json({error:"Profile picture is too large. Please choose a smaller image."});
    await dbRun("UPDATE profiles SET avatar_data=? WHERE user_id=?",[avatar||null,req.session.userId]);
    res.json({ok:true});
  });

  app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

  app.get("/api/me",requireLogin,async(req,res)=>{
    const user=await dbGet("SELECT id,username,created_at FROM users WHERE id=?",[req.session.userId]);
    if(!user)return res.status(401).json({error:"Session expired."});
    const profile=await dbGet("SELECT * FROM profiles WHERE user_id=?",[req.session.userId]);
    res.json({user,profile:profile||null});
  });

  app.post("/api/profile",requireLogin,async(req,res)=>{
    try{
      const p=req.body;
      const values=[
        cleanText(p.student_name,100),cleanText(p.father_name,100),cleanText(p.mother_name,100),
        cleanText(p.address,300),cleanText(p.contact,40),cleanText(p.dob,20),
        cleanText(p.roll_number,40),cleanText(p.class_name,40),cleanText(p.group_name,40),
        cleanText(p.qualification,100),cleanText(p.board,60)
      ];
      if(!values[0]||!values[6]||!values[7])return res.status(400).json({error:"Student name, roll number and class are required."});
      await dbRun(`INSERT INTO profiles (user_id,student_name,father_name,mother_name,address,contact,dob,roll_number,class_name,group_name,qualification,board)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET student_name=excluded.student_name,father_name=excluded.father_name,mother_name=excluded.mother_name,address=excluded.address,contact=excluded.contact,dob=excluded.dob,roll_number=excluded.roll_number,class_name=excluded.class_name,group_name=excluded.group_name,qualification=excluded.qualification,board=excluded.board`,[req.session.userId,...values]);
      res.json({ok:true});
    }catch(e){console.error("profile",e);res.status(500).json({error:"Could not save profile."});}
  });

  const allowedMedia=new Set(["image/jpeg","image/jpg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime"]);
  app.post("/api/posts",requireLogin,async(req,res)=>{
    try{
      const body=cleanText(req.body.body,2000),mediaData=String(req.body.media_data||""),mediaType=cleanText(req.body.media_type,80);
      if(!body&&!mediaData)return res.status(400).json({error:"Write something or add media first."});
      if(mediaData.length>11500000)return res.status(413).json({error:"Media is too large."});
      if(mediaData&&!allowedMedia.has(mediaType))return res.status(400).json({error:"Unsupported media type."});
      if(mediaData&&!/^data:(image|video)\/[a-z0-9.+-]+;base64,/i.test(mediaData))return res.status(400).json({error:"Invalid media data."});
      const post=await dbGet("INSERT INTO posts (user_id,body,media_data,media_type) VALUES (?,?,?,?) RETURNING id",[req.session.userId,body,mediaData||null,mediaData?mediaType:null]);
      res.json({ok:true,id:post.id});
    }catch(e){console.error("post",e);res.status(500).json({error:"Could not publish post."});}
  });

  app.get("/api/posts",requireLogin,async(req,res)=>{
    const posts=await dbAll(`SELECT posts.id,posts.body,posts.media_data,posts.media_type,posts.created_at,
      users.username,profiles.student_name,profiles.avatar_data
      FROM posts JOIN users ON users.id=posts.user_id
      LEFT JOIN profiles ON profiles.user_id=posts.user_id
      ORDER BY posts.id DESC LIMIT 100`);
    res.json(posts);
  });

  const backupTimer=backupPool&&db?setInterval(syncSqliteBackup,5*60*1000):null;
  if(backupTimer)backupTimer.unref();
  const cleanupSessions=async()=>{try{await dbRun("DELETE FROM sessions WHERE expires_at <= ?",[Date.now()]);}catch{}};
  const sessionCleanupTimer=setInterval(cleanupSessions,15*60*1000);
  sessionCleanupTimer.unref();

  app.listen(PORT,HOST,()=>console.log("SCI J running at http://localhost:"+PORT));
}

start().catch(err=>{console.error("Fatal startup error",err);process.exit(1);});
