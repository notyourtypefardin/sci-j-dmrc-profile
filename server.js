const express = require("express");
const path = require("path");
const fs = require("fs");
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
const POSTGRES_URL = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || process.env.BACKUP_DATABASE_URL;
const USE_POSTGRES = process.env.USE_POSTGRES === "true" && Boolean(POSTGRES_URL);
const MIGRATE_SQLITE_TO_POSTGRES = process.env.MIGRATE_SQLITE_TO_POSTGRES === "true";
let db, pool;

function qmarks(sql){let i=0;return sql.replace(/\?/g,()=>"$"+(++i));}
async function dbGet(sql,p=[]){return USE_POSTGRES?(await pool.query(qmarks(sql),p)).rows[0]||null:db.prepare(sql).get(...p)||null;}
async function dbAll(sql,p=[]){return USE_POSTGRES?(await pool.query(qmarks(sql),p)).rows:db.prepare(sql).all(...p);}
async function dbRun(sql,p=[]){return USE_POSTGRES?(await pool.query(qmarks(sql),p)).rowCount:db.prepare(sql).run(...p).changes;}
function clean(v,max){return String(v??"").trim().slice(0,max);}
function bool(v){return v===true||v==="true"||v===1||v==="1";}
function requireLogin(req,res,next){if(!req.session.userId)return res.status(401).json({error:"Login required."});next();}
function requireAdmin(req,res,next){if(!req.session.adminId)return res.status(403).json({error:"Admin access required."});next();}

async function migrateSqliteToPostgres(){
  const sqlitePath=process.env.DB_PATH||path.join(__dirname,"sci_j.db");
  if(!fs.existsSync(sqlitePath)){console.warn("SQLite migration skipped: database file not found.");return;}
  const Database=require("better-sqlite3");
  const sdb=new Database(sqlitePath,{readonly:true});
  try{
    const existing=await pool.query("SELECT COUNT(*)::int AS count FROM users");
    if(Number(existing.rows[0]?.count||0)>0){console.log("SQLite migration skipped: Postgres already contains users.");return;}
    const tables=["users","profiles","posts","post_likes","comments","post_shares"];
    const data={};
    for(const t of tables){try{data[t]=sdb.prepare("SELECT * FROM "+t).all()}catch{data[t]=[]}}
    await pool.query("BEGIN");
    for(const r of data.users){
      await pool.query("INSERT INTO users(id,username,password_hash,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[r.id,r.username,r.password_hash,r.created_at||null]);
    }
    for(const r of data.profiles){
      await pool.query("INSERT INTO profiles(id,user_id,student_name,father_name,mother_name,address,contact,dob,roll_number,class_name,group_name,qualification,board,avatar_data,privacy_father,privacy_mother,privacy_contact,privacy_address,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT DO NOTHING",[r.id,r.user_id,r.student_name,r.father_name,r.mother_name,r.address,r.contact,r.dob,r.roll_number,r.class_name,r.group_name,r.qualification,r.board,r.avatar_data,Boolean(r.privacy_father),Boolean(r.privacy_mother),Boolean(r.privacy_contact),Boolean(r.privacy_address),r.created_at||null,r.updated_at||r.created_at||null]);
    }
    for(const r of data.posts){
      await pool.query("INSERT INTO posts(id,user_id,body,media_data,media_type,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",[r.id,r.user_id,r.body||"",r.media_data,r.media_type,r.created_at||null,r.updated_at||r.created_at||null]);
    }
    for(const r of data.post_likes){
      await pool.query("INSERT INTO post_likes(post_id,user_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[r.post_id,r.user_id,r.created_at||null]);
    }
    for(const r of data.comments){
      await pool.query("INSERT INTO comments(id,post_id,user_id,body,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",[r.id,r.post_id,r.user_id,r.body||"",r.created_at||null,r.updated_at||r.created_at||null]);
    }
    for(const r of data.post_shares){
      await pool.query("INSERT INTO post_shares(id,post_id,user_id,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[r.id,r.post_id,r.user_id,r.created_at||null]);
    }
    for(const t of ["users","profiles","posts","comments","post_shares"]){
      await pool.query("SELECT setval(pg_get_serial_sequence($1,'id'),COALESCE((SELECT MAX(id) FROM "+t+"),1),true)",[t]);
    }
    await pool.query("DELETE FROM sessions");
    await pool.query("COMMIT");
    console.log("SQLite migration complete:",Object.fromEntries(tables.map(t=>[t,data[t].length])));
  }catch(e){
    try{await pool.query("ROLLBACK")}catch{}
    throw e;
  }finally{sdb.close()}
}

async function initDatabase(){
  if(USE_POSTGRES){
    pool=new Pool({connectionString:POSTGRES_URL,max:4,idleTimeoutMillis:30000,connectionTimeoutMillis:10000,ssl:{rejectUnauthorized:false}});
    await pool.query("SELECT 1");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS profiles(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,student_name TEXT NOT NULL,father_name TEXT,mother_name TEXT,address TEXT,contact TEXT,dob TEXT,roll_number TEXT NOT NULL,class_name TEXT NOT NULL,group_name TEXT,qualification TEXT,board TEXT,avatar_data TEXT,privacy_father BOOLEAN NOT NULL DEFAULT FALSE,privacy_mother BOOLEAN NOT NULL DEFAULT FALSE,privacy_contact BOOLEAN NOT NULL DEFAULT FALSE,privacy_address BOOLEAN NOT NULL DEFAULT FALSE,privacy_roll BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY,expires_at BIGINT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS posts(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL DEFAULT '',media_data TEXT,media_type TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS post_likes(post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(post_id,user_id));
      CREATE TABLE IF NOT EXISTS comments(id BIGSERIAL PRIMARY KEY,post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS post_shares(id BIGSERIAL PRIMARY KEY,post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
      CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id,created_at);
      CREATE INDEX IF NOT EXISTS idx_profiles_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_profiles_roll ON profiles(roll_number);
      CREATE TABLE IF NOT EXISTS ai_memories(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,memory_key TEXT NOT NULL,content TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,memory_key));
      CREATE TABLE IF NOT EXISTS ai_messages(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,role TEXT NOT NULL,content TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);\n      CREATE TABLE IF NOT EXISTS creator_intro(id INTEGER PRIMARY KEY,creator_text TEXT NOT NULL,creator_image_data TEXT,creator_crop TEXT NOT NULL DEFAULT '{"x":50,"y":50,"zoom":1}',updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS idx_ai_memories_user ON ai_memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_ai_messages_user ON ai_messages(user_id,created_at DESC);
    `);
    await pool.query("ALTER TABLE creator_intro ADD COLUMN IF NOT EXISTS creator_crop TEXT NOT NULL DEFAULT '{\"x\":50,\"y\":50,\"zoom\":1}'");
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS privacy_father BOOLEAN NOT NULL DEFAULT FALSE");
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS privacy_mother BOOLEAN NOT NULL DEFAULT FALSE");
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS privacy_contact BOOLEAN NOT NULL DEFAULT FALSE");
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS privacy_address BOOLEAN NOT NULL DEFAULT FALSE");
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await pool.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP");
    if(MIGRATE_SQLITE_TO_POSTGRES) await migrateSqliteToPostgres();
    return;
  }
  const Database = require("better-sqlite3");
  db=new Database(process.env.DB_PATH||path.join(__dirname,"sci_j.db"));
  db.pragma("journal_mode=WAL");db.pragma("synchronous=FULL");db.pragma("foreign_keys=ON");db.pragma("busy_timeout=5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS profiles(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL UNIQUE,student_name TEXT NOT NULL,father_name TEXT,mother_name TEXT,address TEXT,contact TEXT,dob TEXT,roll_number TEXT NOT NULL,class_name TEXT NOT NULL,group_name TEXT,qualification TEXT,board TEXT,avatar_data TEXT,privacy_father INTEGER DEFAULT 0,privacy_mother INTEGER DEFAULT 0,privacy_contact INTEGER DEFAULT 0,privacy_address INTEGER DEFAULT 0,privacy_roll INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,body TEXT NOT NULL DEFAULT '',media_data TEXT,media_type TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS post_likes(post_id INTEGER NOT NULL,user_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(post_id,user_id));
    CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY AUTOINCREMENT,post_id INTEGER NOT NULL,user_id INTEGER NOT NULL,body TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS post_shares(id INTEGER PRIMARY KEY AUTOINCREMENT,post_id INTEGER NOT NULL,user_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
    CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id);
    CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);
    CREATE INDEX IF NOT EXISTS idx_shares_post ON post_shares(post_id);
    CREATE TRIGGER IF NOT EXISTS trg_delete_post_children AFTER DELETE ON posts BEGIN
      DELETE FROM post_likes WHERE post_id=OLD.id;
      DELETE FROM comments WHERE post_id=OLD.id;
      DELETE FROM post_shares WHERE post_id=OLD.id;
    END;
    CREATE TRIGGER IF NOT EXISTS trg_delete_user_social AFTER DELETE ON users BEGIN
      DELETE FROM post_likes WHERE user_id=OLD.id;
      DELETE FROM comments WHERE user_id=OLD.id;
      DELETE FROM post_shares WHERE user_id=OLD.id;
    END;
  `);
}

class SessionStore extends session.Store{
  get(sid,cb){dbGet("SELECT data,expires_at FROM sessions WHERE sid=?",[sid]).then(async r=>{if(!r)return cb(null,null);if(Number(r.expires_at)<=Date.now()){await dbRun("DELETE FROM sessions WHERE sid=?",[sid]);return cb(null,null)}cb(null,JSON.parse(r.data));}).catch(cb)}
  set(sid,sess,cb){const e=sess?.cookie?.expires?new Date(sess.cookie.expires).getTime():Date.now()+(Number(sess?.cookie?.maxAge)||86400000);dbRun("INSERT INTO sessions(sid,expires_at,data) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET expires_at=excluded.expires_at,data=excluded.data",[sid,e,JSON.stringify(sess)]).then(()=>cb()).catch(cb)}
  destroy(sid,cb){dbRun("DELETE FROM sessions WHERE sid=?",[sid]).then(()=>cb()).catch(cb)}
  touch(sid,sess,cb){const e=sess?.cookie?.expires?new Date(sess.cookie.expires).getTime():Date.now()+(Number(sess?.cookie?.maxAge)||86400000);dbRun("UPDATE sessions SET expires_at=? WHERE sid=?",[e,sid]).then(()=>cb()).catch(cb)}
}

function adminUsernames(){
  const many=String(process.env.ADMIN_USERNAMES||"").split(",").map(x=>clean(x,64).toUpperCase()).filter(Boolean);
  const one=clean(process.env.ADMIN_USERNAME,64).toUpperCase();
  return [...new Set([one,...many].filter(Boolean))];
}
function isAdminUsername(username){return adminUsernames().includes(clean(username,64).toUpperCase());}

async function ensureAdmin(){
  const username=clean(process.env.ADMIN_USERNAME,64).toUpperCase(),hash=clean(process.env.ADMIN_PASSWORD_HASH,200);
  if(!username||!hash){console.warn("ADMIN_USERNAME/ADMIN_PASSWORD_HASH not configured");return;}
  const old=await dbGet("SELECT id FROM users WHERE username=?",[username]);
  if(old){await dbRun("UPDATE users SET username=?,password_hash=? WHERE id=?",[username,hash,old.id]);return;}
  await dbRun("INSERT INTO users(username,password_hash) VALUES(?,?)",[username,hash]);
}

const AI_DEFAULT_MEMORIES=[
  ["identity","SCI J DMRC Profile is a polished, mobile-first DMRC Student Community website for DMRC students."],
  ["purpose","The website provides account registration/login, unique DMRC usernames, student profiles, a searchable student directory, posts, likes, comments, shares, visitor profiles and privacy controls."],
  ["creator","Website creator/admin: Fardin (also known as Siuuu). The admin account is configured server-side through ADMIN_USERNAME/ADMIN_PASSWORD_HASH. Never guess or reveal credentials."],
  ["features","Core features include unique DMRC usernames (DMRC00001, DMRC00002...), bcrypt password hashing with minimum 8-character passwords, profile onboarding/editing, profile-picture upload, roll/class/group/board details, student search, ordered directory, visitor profile view, photo/video posts, likes, comments, shares, admin moderation, creator-introduction management, session authentication and owner-only Personal AI."],
  ["privacy","Visitor profiles can expose roll number and selected profile information. Father, mother, contact and address fields have privacy controls enforced server-side. Never expose hidden/private fields to visitors."],
  ["admin","The admin can manage the creator introduction, moderate posts/comments, view basic site statistics and use the owner-only Personal AI. Do not claim the admin can do something that is not implemented."],
  ["ai_behavior","Always answer politely, respectfully and clearly. Prefer the user's language when practical. Use verified project knowledge and supplied memory. Never invent facts, credentials, usernames, database data or capabilities. If the answer is not known or cannot be verified, apologize briefly and say the information is not currently available rather than guessing."],
  ["security","Never expose passwords, database credentials, access tokens, session secrets or other secrets. Personal AI is owner-only and destructive actions must be protected. Never bypass authentication or permission checks."],
  ["free_mode","The Personal AI prioritizes a $0 setup. Built-in knowledge mode works without an AI API. An external OpenAI-compatible provider can be enabled later with server-side environment variables."]
];
async function ensureAiMemory(userId){
  for(const [k,c] of AI_DEFAULT_MEMORIES){
    await dbRun("INSERT INTO ai_memories(user_id,memory_key,content) VALUES(?,?,?) ON CONFLICT(user_id,memory_key) DO NOTHING",[userId,k,c]);
  }
}
async function aiBuiltInReply(message,userId){
  const q=message.toLowerCase();
  if(q.startsWith("remember:")||q.startsWith("মনে রাখো:")){const raw=message.replace(/^(remember:|মনে রাখো:)\s*/i,"").trim();if(raw){const key=("note-"+Date.now()).slice(0,60);await dbRun("INSERT INTO ai_memories(user_id,memory_key,content) VALUES(?,?,?)",[userId,key,raw]);return "ঠিক আছে — আমি এই তথ্যটা Personal AI memory-তে save করেছি।";}}
  if(/^(hi|hello|hey|salam|assalamu)/.test(q)) return "Hey Siuuu 👋 আমি তোমার SCI J Personal AI। এখন $0 Knowledge Mode-এ আছি—তোমার SCI J-এর saved knowledge, memory আর project rules ধরে সাহায্য করতে পারি।";
  if(q.includes("who are you")||q.includes("তুমি কে")||q.includes("personal ai")){
    return "আমি SCI J Personal AI। এই free mode-এ আমি তোমার project knowledge, saved memory এবং গুরুত্বপূর্ণ rules ধরে কাজ করি। পরে server-side AI provider যোগ করলে general AI reasoning-ও পাওয়া যাবে।";
  }
  if(q.includes("creator")||q.includes("fardin")||q.includes("siuuu")){
    return "Creator's Introduction: Hey, I'm Fardin (you can also call me Siuuu), a Science student at DMRC (Section J).";
  }
  if(q.includes("roll")||q.includes("রোল")) return "SCI J-এ Roll Number visitor profile-এ visible থাকবে। Roll privacy control সরানো হয়েছে।";
  if(q.includes("security")||q.includes("নিরাপত্তা")||q.includes("secure")){
    return "Security rules: owner-only Personal AI, server-side secrets, authenticated sessions, rate limits, password hashing, permission checks এবং destructive actions-এর জন্য access control।";
  }
  if(q.includes("telegram")) return "Telegram integration এখন core AI-এর পরে করার জন্য রাখা হয়েছে। Bot token server-side secret হিসেবে রাখতে হবে।";
  if(q.includes("whatsapp")) return "WhatsApp integration পরে করা হবে। এখন Personal AI core ও SCI J integration আগে।";
  if(q.includes("feature")||q.includes("কি কি")||q.includes("what can")){
    return "আমি SCI J-এর profiles, posts, likes, comments, shares, student search, visitor profiles, admin moderation, backups এবং তোমার saved project instructions সম্পর্কে context রাখতে পারি।";
  }
  if(q.includes("status")||q.includes("অবস্থা")){
    const [u,p,c,l]=await Promise.all([dbGet("SELECT COUNT(*) count FROM users"),dbGet("SELECT COUNT(*) count FROM posts"),dbGet("SELECT COUNT(*) count FROM comments"),dbGet("SELECT COUNT(*) count FROM post_likes")]);
    return `SCI J status: ${Number(u?.count||0)} users, ${Number(p?.count||0)} posts, ${Number(c?.count||0)} comments, ${Number(l?.count||0)} likes. Personal AI is running in free Knowledge Mode.`;
  }
  if(q.includes("memory")||q.includes("মনে")||q.includes("remember")){
    const rows=await dbAll("SELECT memory_key,content FROM ai_memories WHERE user_id=? ORDER BY updated_at DESC LIMIT 20",[userId]);
    return "Saved AI memory:\n"+rows.map(x=>"• "+x.memory_key+": "+x.content).join("\n");
  }
  return "দুঃখিত — এই প্রশ্নের নির্ভরযোগ্য উত্তর আমার বর্তমান SCI J knowledge-এ নেই। ভুল তথ্য না দিয়ে আমি বরং বলছি যে এই মুহূর্তে বিষয়টি নিশ্চিতভাবে জানি না।";
}
async function aiExternalReply(message,history,memories){
  const url=String(process.env.AI_API_URL||"https://openrouter.ai/api/v1/chat/completions").trim();
  const key=String(process.env.AI_API_KEY||"").trim();
  if(!key) return null;
  const model=String(process.env.AI_MODEL||"openrouter/free").trim();
  const system="You are the SCI J DMRC Personal AI assistant. Be polite, respectful, calm and helpful. Answer in the user's language when practical (Bangla/Banglish/English). Use verified project knowledge and supplied memory; do not invent facts. Explain website features accurately. Never reveal secrets, credentials or private user data. If you do not know or cannot verify an answer, apologize briefly and clearly say that the information is not currently available instead of guessing. Project knowledge:\\n"+memories.map(x=>x.content).join("\\n");
  const messages=[{role:"system",content:system},...history.slice(-12).map(x=>({role:x.role==="assistant"?"assistant":"user",content:x.content})),{role:"user",content:message}];
  const response=await fetch(url,{method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json","HTTP-Referer":process.env.SITE_URL||"https://www.dmrcprofile.com","X-Title":"SCI J DMRC Profile"},body:JSON.stringify({model,messages,temperature:0.4,max_tokens:700})});
  if(!response.ok) throw new Error("AI provider HTTP "+response.status);
  const data=await response.json();
  const answer=data?.choices?.[0]?.message?.content;
  if(typeof answer!=="string"||!answer.trim()) throw new Error("AI provider returned no answer");
  return answer.trim();
}

  app.get("/api/ai/history",requirePersonalAI,async(req,res)=>{const rows=await dbAll("SELECT id,role,content,created_at FROM ai_messages WHERE user_id=? ORDER BY id DESC LIMIT 60",[req.session.userId]);res.json(rows.reverse())});
  app.get("/api/ai/memory",requirePersonalAI,async(req,res)=>{await ensureAiMemory(req.session.userId);res.json(await dbAll("SELECT id,memory_key,content,created_at,updated_at FROM ai_memories WHERE user_id=? ORDER BY id ASC LIMIT 50",[req.session.userId]))});
  app.post("/api/ai/memory",requirePersonalAI,writeLimiter,async(req,res)=>{const key=clean(req.body.key,60).toLowerCase().replace(/[^a-z0-9_-]/g,"-"),content=clean(req.body.content,2000);if(!key||!content)return res.status(400).json({error:"Memory key and content are required."});await dbRun("INSERT INTO ai_memories(user_id,memory_key,content,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(user_id,memory_key) DO UPDATE SET content=excluded.content,updated_at=CURRENT_TIMESTAMP",[req.session.userId,key,content]);res.json({ok:true})});
  app.delete("/api/ai/memory/:key",requirePersonalAI,writeLimiter,async(req,res)=>{const key=clean(req.params.key,60).toLowerCase();await dbRun("DELETE FROM ai_memories WHERE user_id=? AND memory_key=?",[req.session.userId,key]);res.json({ok:true})});
  app.post("/api/ai/chat",requirePersonalAI,writeLimiter,async(req,res)=>{try{const message=clean(req.body.message,2000);if(!message)return res.status(400).json({error:"Message is empty."});await ensureAiMemory(req.session.userId);const history=await dbAll("SELECT role,content FROM ai_messages WHERE user_id=? ORDER BY id DESC LIMIT 12",[req.session.userId]);history.reverse();const memories=await dbAll("SELECT memory_key,content FROM ai_memories WHERE user_id=? ORDER BY updated_at DESC LIMIT 30",[req.session.userId]);await dbRun("INSERT INTO ai_messages(user_id,role,content) VALUES(?,?,?)",[req.session.userId,"user",message]);let answer=null,mode="builtin";try{answer=await aiExternalReply(message,history,memories);if(answer)mode="external"}catch(e){console.warn("AI provider unavailable; using built-in mode:",e.message)}if(!answer)answer=await aiBuiltInReply(message,req.session.userId);await dbRun("INSERT INTO ai_messages(user_id,role,content) VALUES(?,?,?)",[req.session.userId,"assistant",answer]);res.json({ok:true,answer,mode})}catch(e){console.error(e);res.status(500).json({error:"Personal AI failed."})}});
  
  app.get("/api/creator-intro",async(req,res)=>{const row=await dbGet("SELECT creator_text,creator_image_data,creator_crop,updated_at FROM creator_intro WHERE id=1");res.json(row||{creator_text:"",creator_image_data:null});});
  app.post("/api/admin/creator-intro",requireLogin,requireAdmin,writeLimiter,async(req,res)=>{try{const text=clean(req.body.creator_text,1200);const image=String(req.body.creator_image_data||"");let crop={x:50,y:50,zoom:1};try{const c=req.body.creator_crop||{};crop={x:Math.max(0,Math.min(100,Number(c.x)||50)),y:Math.max(0,Math.min(100,Number(c.y)||50)),zoom:Math.max(1,Math.min(3,Number(c.zoom)||1))}}catch{}if(image&&(!image.startsWith("data:image/")||image.length>8*1024*1024))return res.status(400).json({error:"Invalid creator image."});await dbRun("INSERT INTO creator_intro(id,creator_text,creator_image_data,creator_crop,updated_at) VALUES(1,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET creator_text=EXCLUDED.creator_text,creator_image_data=EXCLUDED.creator_image_data,creator_crop=EXCLUDED.creator_crop,updated_at=CURRENT_TIMESTAMP",[text,image||null,JSON.stringify(crop)]);res.json({ok:true});}catch(e){console.error(e);res.status(500).json({error:"Could not update creator introduction."})}});
  app.get("/api/admin/posts",requireLogin,requireAdmin,async(req,res)=>res.json(await dbAll(`SELECT p.id,p.body,p.created_at,u.username,pr.student_name FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN profiles pr ON pr.user_id=p.user_id ORDER BY p.created_at DESC LIMIT 200`)));
  app.get("/api/admin/comments",requireLogin,requireAdmin,async(req,res)=>res.json(await dbAll(`SELECT c.id,c.body,c.created_at,u.username,p.student_name FROM comments c JOIN users u ON u.id=c.user_id LEFT JOIN profiles p ON p.user_id=c.user_id ORDER BY c.created_at DESC LIMIT 200`)));
  app.delete("/api/admin/posts/:id",requireLogin,requireAdmin,async(req,res)=>{await dbRun("DELETE FROM posts WHERE id=?",[Number(req.params.id)]);res.json({ok:true})});
  app.delete("/api/admin/comments/:id",requireLogin,requireAdmin,async(req,res)=>{await dbRun("DELETE FROM comments WHERE id=?",[Number(req.params.id)]);res.json({ok:true})});
  app.get("/api/admin/stats",requireLogin,requireAdmin,async(req,res)=>{const [u,p,c,l]=await Promise.all([dbGet("SELECT COUNT(*) count FROM users"),dbGet("SELECT COUNT(*) count FROM posts"),dbGet("SELECT COUNT(*) count FROM comments"),dbGet("SELECT COUNT(*) count FROM post_likes")]);res.json({users:Number(u?.count||0),posts:Number(p?.count||0),comments:Number(c?.count||0),likes:Number(l?.count||0)})});
  setInterval(async()=>{try{await dbRun("DELETE FROM sessions WHERE expires_at <= ?",[Date.now()])}catch{}},15*60*1000).unref();
  app.listen(PORT,HOST,()=>console.log(`SCI J running on ${PORT} (${USE_POSTGRES?"Postgres":"SQLite fallback"})`));
}
start().catch(e=>{console.error("Fatal startup",e);process.exit(1)});