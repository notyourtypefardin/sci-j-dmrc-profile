const express = require("express");
const path = require("path");
const fs = require("fs");
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
let db, pool;

function qmarks(sql){let i=0;return sql.replace(/\?/g,()=>"$"+(++i));}
async function dbGet(sql,p=[]){return USE_POSTGRES?(await pool.query(qmarks(sql),p)).rows[0]||null:db.prepare(sql).get(...p)||null;}
async function dbAll(sql,p=[]){return USE_POSTGRES?(await pool.query(qmarks(sql),p)).rows:db.prepare(sql).all(...p);}
async function dbRun(sql,p=[]){return USE_POSTGRES?(await pool.query(qmarks(sql),p)).rowCount:db.prepare(sql).run(...p).changes;}
function clean(v,max){return String(v??"").trim().slice(0,max);}
function bool(v){return v===true||v==="true"||v===1||v==="1";}
function requireLogin(req,res,next){if(!req.session.userId)return res.status(401).json({error:"Login required."});next();}
function requireAdmin(req,res,next){if(!req.session.adminId)return res.status(403).json({error:"Admin access required."});next();}

async function initDatabase(){
  if(USE_POSTGRES){
    pool=new Pool({connectionString:process.env.DATABASE_URL,max:8,idleTimeoutMillis:30000,connectionTimeoutMillis:10000,ssl:{rejectUnauthorized:false}});
    await pool.query("SELECT 1");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS profiles(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,student_name TEXT NOT NULL,father_name TEXT,mother_name TEXT,address TEXT,contact TEXT,dob TEXT,roll_number TEXT NOT NULL,class_name TEXT NOT NULL,group_name TEXT,qualification TEXT,board TEXT,avatar_data TEXT,privacy_father BOOLEAN NOT NULL DEFAULT FALSE,privacy_mother BOOLEAN NOT NULL DEFAULT FALSE,privacy_contact BOOLEAN NOT NULL DEFAULT FALSE,privacy_address BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
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
    `);
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS privacy_father BOOLEAN NOT NULL DEFAULT FALSE");
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS privacy_mother BOOLEAN NOT NULL DEFAULT FALSE");
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS privacy_contact BOOLEAN NOT NULL DEFAULT FALSE");
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS privacy_address BOOLEAN NOT NULL DEFAULT FALSE");
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await pool.query("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP");
    await pool.query("ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP");
    return;
  }
  db=new Database(process.env.DB_PATH||path.join(__dirname,"sci_j.db"));
  db.pragma("journal_mode=WAL");db.pragma("synchronous=FULL");db.pragma("foreign_keys=ON");db.pragma("busy_timeout=5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS profiles(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL UNIQUE,student_name TEXT NOT NULL,father_name TEXT,mother_name TEXT,address TEXT,contact TEXT,dob TEXT,roll_number TEXT NOT NULL,class_name TEXT NOT NULL,group_name TEXT,qualification TEXT,board TEXT,avatar_data TEXT,privacy_father INTEGER DEFAULT 0,privacy_mother INTEGER DEFAULT 0,privacy_contact INTEGER DEFAULT 0,privacy_address INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS sessions(sid TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,body TEXT NOT NULL DEFAULT '',media_data TEXT,media_type TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS post_likes(post_id INTEGER NOT NULL,user_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(post_id,user_id));
    CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY AUTOINCREMENT,post_id INTEGER NOT NULL,user_id INTEGER NOT NULL,body TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS post_shares(id INTEGER PRIMARY KEY AUTOINCREMENT,post_id INTEGER NOT NULL,user_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);
  `);
}

class SessionStore extends session.Store{
  get(sid,cb){dbGet("SELECT data,expires_at FROM sessions WHERE sid=?",[sid]).then(async r=>{if(!r)return cb(null,null);if(Number(r.expires_at)<=Date.now()){await dbRun("DELETE FROM sessions WHERE sid=?",[sid]);return cb(null,null)}cb(null,JSON.parse(r.data));}).catch(cb)}
  set(sid,sess,cb){const e=sess?.cookie?.expires?new Date(sess.cookie.expires).getTime():Date.now()+(Number(sess?.cookie?.maxAge)||86400000);dbRun("INSERT INTO sessions(sid,expires_at,data) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET expires_at=excluded.expires_at,data=excluded.data",[sid,e,JSON.stringify(sess)]).then(()=>cb()).catch(cb)}
  destroy(sid,cb){dbRun("DELETE FROM sessions WHERE sid=?",[sid]).then(()=>cb()).catch(cb)}
  touch(sid,sess,cb){const e=sess?.cookie?.expires?new Date(sess.cookie.expires).getTime():Date.now()+(Number(sess?.cookie?.maxAge)||86400000);dbRun("UPDATE sessions SET expires_at=? WHERE sid=?",[e,sid]).then(()=>cb()).catch(cb)}
}

async function ensureAdmin(){
  const username=clean(process.env.ADMIN_USERNAME,64),hash=clean(process.env.ADMIN_PASSWORD_HASH,200);
  if(!username||!hash){console.warn("ADMIN_USERNAME/ADMIN_PASSWORD_HASH not configured");return;}
  const old=await dbGet("SELECT id FROM users WHERE username=?",[username]);
  if(old){await dbRun("UPDATE users SET password_hash=? WHERE username=?",[hash,username]);return;}
  await dbRun("INSERT INTO users(username,password_hash) VALUES(?,?)",[username,hash]);
}

async function start(){
  await initDatabase();await ensureAdmin();
  app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false,referrerPolicy:{policy:"strict-origin-when-cross-origin"}}));
  app.use(express.json({limit:"12mb"}));app.use(express.urlencoded({extended:true,limit:"1mb"}));
  const authLimiter=rateLimit({windowMs:15*60*1000,limit:12,standardHeaders:"draft-8",legacyHeaders:false,message:{error:"Too many login attempts. Please try again later."}});
  const writeLimiter=rateLimit({windowMs:60*1000,limit:45,standardHeaders:"draft-8",legacyHeaders:false,message:{error:"Too many actions. Please slow down."}});
  app.use("/api",rateLimit({windowMs:60*1000,limit:180,standardHeaders:"draft-8",legacyHeaders:false}));
  app.use(session({store:new SessionStore(),secret:process.env.SESSION_SECRET||"unsafe-dev-secret",resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",maxAge:86400000}}));
  app.get("/",(req,res,next)=>{try{const file=path.join(__dirname,"public","index.html");const html=fs.readFileSync(file,"utf8").replace("</body>",'<script src="/upgrade.js"></script></body>');res.type("html").send(html)}catch(e){next(e)}});
  app.use(express.static(path.join(__dirname,"public"),{etag:true,maxAge:"1h"}));
  app.get("/healthz",(req,res)=>res.json({ok:true,database:USE_POSTGRES?"postgres":"sqlite",features:["social","privacy","admin","profile-search"]}));

  app.post("/api/register",authLimiter,async(req,res)=>{try{const pw=String(req.body.password||"");if(pw.length<8||pw.length>128)return res.status(400).json({error:"Password must be 8–128 characters."});let n=Number((await dbGet("SELECT COUNT(*) count FROM users"))?.count||0)+1,username;do{username="DMRC"+String(n++).padStart(5,"0")}while(await dbGet("SELECT id FROM users WHERE username=?",[username]));const u=USE_POSTGRES?await dbGet("INSERT INTO users(username,password_hash) VALUES(?,?) RETURNING id,username",[username,await bcrypt.hash(pw,12)]):(await dbRun("INSERT INTO users(username,password_hash) VALUES(?,?)",[username,await bcrypt.hash(pw,12)]),await dbGet("SELECT id,username FROM users WHERE username=?",[username]));req.session.regenerate(e=>{if(e)return res.status(500).json({error:"Could not start secure session."});req.session.userId=u.id;req.session.save(se=>se?res.status(500).json({error:"Could not save session."}):res.json({ok:true,username:u.username}))})}catch(e){console.error(e);res.status(500).json({error:"Could not create account."})}});
  app.post("/api/login",authLimiter,async(req,res)=>{try{const username=clean(req.body.username,64).toUpperCase(),pw=String(req.body.password||""),u=await dbGet("SELECT * FROM users WHERE username=?",[username]);if(!u||pw.length>128||!(await bcrypt.compare(pw,u.password_hash)))return res.status(401).json({error:"Invalid username or password."});const isAdmin=Boolean(process.env.ADMIN_USERNAME&&username===process.env.ADMIN_USERNAME);req.session.regenerate(e=>{if(e)return res.status(500).json({error:"Could not start secure session."});req.session.userId=u.id;if(isAdmin)req.session.adminId=u.id;req.session.save(se=>se?res.status(500).json({error:"Could not save session."}):res.json({ok:true,username:u.username,admin:isAdmin}))})}catch(e){res.status(500).json({error:"Login failed."})}});
  app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));
  app.get("/api/me",requireLogin,async(req,res)=>{const u=await dbGet("SELECT id,username,created_at FROM users WHERE id=?",[req.session.userId]);if(!u)return res.status(401).json({error:"Session expired."});const p=await dbGet("SELECT * FROM profiles WHERE user_id=?",[u.id]);res.json({user:u,profile:p||null,admin:Boolean(req.session.adminId)})});

  app.post("/api/profile",requireLogin,writeLimiter,async(req,res)=>{try{const p=req.body,v=[clean(p.student_name,100),clean(p.father_name,100),clean(p.mother_name,100),clean(p.address,300),clean(p.contact,40),clean(p.dob,20),clean(p.roll_number,40),clean(p.class_name,40),clean(p.group_name,40),clean(p.qualification,100),clean(p.board,60),bool(p.privacy_father),bool(p.privacy_mother),bool(p.privacy_contact),bool(p.privacy_address)];if(!v[0]||!v[6]||!v[7])return res.status(400).json({error:"Student name, roll number and class are required."});await dbRun(`INSERT INTO profiles(user_id,student_name,father_name,mother_name,address,contact,dob,roll_number,class_name,group_name,qualification,board,privacy_father,privacy_mother,privacy_contact,privacy_address,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET student_name=excluded.student_name,father_name=excluded.father_name,mother_name=excluded.mother_name,address=excluded.address,contact=excluded.contact,dob=excluded.dob,roll_number=excluded.roll_number,class_name=excluded.class_name,group_name=excluded.group_name,qualification=excluded.qualification,board=excluded.board,privacy_father=excluded.privacy_father,privacy_mother=excluded.privacy_mother,privacy_contact=excluded.privacy_contact,privacy_address=excluded.privacy_address,updated_at=CURRENT_TIMESTAMP`,[req.session.userId,...v]);res.json({ok:true})}catch(e){console.error(e);res.status(500).json({error:"Could not save profile."})}});
  app.post("/api/profile/avatar",requireLogin,writeLimiter,async(req,res)=>{const a=String(req.body.avatar_data||"");if(a&&!/^data:image\/(jpeg|jpg|png|webp);base64,/.test(a))return res.status(400).json({error:"Invalid image."});if(a.length>1400000)return res.status(413).json({error:"Profile image is too large."});await dbRun("UPDATE profiles SET avatar_data=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?",[a||null,req.session.userId]);res.json({ok:true})});

  app.get("/api/profile/search",requireLogin,async(req,res)=>{const q=clean(req.query.q,40);if(q.length<2)return res.json([]);const rows=await dbAll(`SELECT u.username,p.student_name,p.roll_number,p.class_name,p.group_name,p.avatar_data FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.username ILIKE ? OR p.student_name ILIKE ? OR p.roll_number ILIKE ? ORDER BY u.username LIMIT 20`,[q+"%",q+"%",q+"%"]);res.json(rows)});
  app.get("/api/profile/:username",requireLogin,async(req,res)=>{const u=await dbGet("SELECT id,username,created_at FROM users WHERE username=?",[clean(req.params.username,64).toUpperCase()]);if(!u)return res.status(404).json({error:"Profile not found."});const p=await dbGet("SELECT * FROM profiles WHERE user_id=?",[u.id]);if(!p)return res.status(404).json({error:"Profile not completed."});const own=req.session.userId===u.id,safe={...p};if(!own&&safe.privacy_father)safe.father_name=null;if(!own&&safe.privacy_mother)safe.mother_name=null;if(!own&&safe.privacy_contact)safe.contact=null;if(!own&&safe.privacy_address)safe.address=null;const posts=await dbAll(`SELECT p.id,p.user_id,p.body,p.media_data,p.media_type,p.created_at,p.updated_at,u.username,pr.student_name,pr.avatar_data,(SELECT COUNT(*) FROM post_likes l WHERE l.post_id=p.id)::int AS like_count,(SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id)::int AS comment_count,(SELECT COUNT(*) FROM post_shares s WHERE s.post_id=p.id)::int AS share_count,EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN profiles pr ON pr.user_id=p.user_id WHERE p.user_id=? ORDER BY p.created_at DESC LIMIT 100`,[req.session.userId,u.id]);res.json({user:{id:u.id,username:u.username,created_at:u.created_at},profile:safe,posts,own})});

  const postSelect=`SELECT p.id,p.user_id,p.body,p.media_data,p.media_type,p.created_at,p.updated_at,u.username,pr.student_name,pr.avatar_data,(SELECT COUNT(*) FROM post_likes l WHERE l.post_id=p.id)::int AS like_count,(SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id)::int AS comment_count,(SELECT COUNT(*) FROM post_shares s WHERE s.post_id=p.id)::int AS share_count,EXISTS(SELECT 1 FROM post_likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN profiles pr ON pr.user_id=p.user_id ORDER BY p.created_at DESC LIMIT 100`;
  app.get("/api/posts",requireLogin,async(req,res)=>res.json(await dbAll(postSelect,[req.session.userId])));
  app.post("/api/posts",requireLogin,writeLimiter,async(req,res)=>{try{const body=clean(req.body.body,2000),data=String(req.body.media_data||""),type=clean(req.body.media_type,80);if(!body&&!data)return res.status(400).json({error:"Write something or add media first."});if(data.length>5600000)return res.status(413).json({error:"Media is too large for the free-tier storage strategy."});const ok=new Set(["image/jpeg","image/jpg","image/png","image/webp","image/gif","video/mp4","video/webm","video/quicktime"]);if(data&&(!ok.has(type)||!/^data:(image|video)\/[a-z0-9.+-]+;base64,/i.test(data)))return res.status(400).json({error:"Unsupported media."});let p;if(USE_POSTGRES)p=await dbGet("INSERT INTO posts(user_id,body,media_data,media_type) VALUES(?,?,?,?) RETURNING id",[req.session.userId,body,data||null,data?type:null]);else{await dbRun("INSERT INTO posts(user_id,body,media_data,media_type) VALUES(?,?,?,?)",[req.session.userId,body,data||null,data?type:null]);p=await dbGet("SELECT id FROM posts WHERE user_id=? ORDER BY id DESC LIMIT 1",[req.session.userId]);}res.json({ok:true,id:p.id})}catch(e){console.error(e);res.status(500).json({error:"Could not publish post."})}});
  app.patch("/api/posts/:id",requireLogin,writeLimiter,async(req,res)=>{const id=Number(req.params.id),p=await dbGet("SELECT user_id FROM posts WHERE id=?",[id]);if(!p)return res.status(404).json({error:"Post not found."});if(p.user_id!==req.session.userId&&!req.session.adminId)return res.status(403).json({error:"You can only edit your own post."});const body=clean(req.body.body,2000);if(!body)return res.status(400).json({error:"Post cannot be empty."});await dbRun("UPDATE posts SET body=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[body,id]);res.json({ok:true})});
  app.delete("/api/posts/:id",requireLogin,writeLimiter,async(req,res)=>{const id=Number(req.params.id),p=await dbGet("SELECT user_id FROM posts WHERE id=?",[id]);if(!p)return res.status(404).json({error:"Post not found."});if(p.user_id!==req.session.userId&&!req.session.adminId)return res.status(403).json({error:"Not allowed."});await dbRun("DELETE FROM posts WHERE id=?",[id]);res.json({ok:true})});
  app.post("/api/posts/:id/like",requireLogin,writeLimiter,async(req,res)=>{const id=Number(req.params.id),existing=await dbGet("SELECT 1 FROM post_likes WHERE post_id=? AND user_id=?",[id,req.session.userId]);if(existing)await dbRun("DELETE FROM post_likes WHERE post_id=? AND user_id=?",[id,req.session.userId]);else await dbRun("INSERT INTO post_likes(post_id,user_id) VALUES(?,?)",[id,req.session.userId]);const n=await dbGet("SELECT COUNT(*) count FROM post_likes WHERE post_id=?",[id]);res.json({liked:!existing,count:Number(n?.count||0)})});
  app.get("/api/posts/:id/comments",requireLogin,async(req,res)=>res.json(await dbAll(`SELECT c.id,c.user_id,c.body,c.created_at,c.updated_at,u.username,p.student_name,p.avatar_data FROM comments c JOIN users u ON u.id=c.user_id LEFT JOIN profiles p ON p.user_id=c.user_id WHERE c.post_id=? ORDER BY c.created_at ASC LIMIT 100`,[Number(req.params.id)])));
  app.post("/api/posts/:id/comments",requireLogin,writeLimiter,async(req,res)=>{const body=clean(req.body.body,1000);if(!body)return res.status(400).json({error:"Comment is empty."});let c;if(USE_POSTGRES)c=await dbGet("INSERT INTO comments(post_id,user_id,body) VALUES(?,?,?) RETURNING id",[Number(req.params.id),req.session.userId,body]);else{await dbRun("INSERT INTO comments(post_id,user_id,body) VALUES(?,?,?)",[Number(req.params.id),req.session.userId,body]);c=await dbGet("SELECT id FROM comments WHERE post_id=? ORDER BY id DESC LIMIT 1",[Number(req.params.id)]);}res.json({ok:true,id:c.id})});
  app.patch("/api/comments/:id",requireLogin,writeLimiter,async(req,res)=>{const c=await dbGet("SELECT user_id FROM comments WHERE id=?",[Number(req.params.id)]);if(!c)return res.status(404).json({error:"Comment not found."});if(c.user_id!==req.session.userId&&!req.session.adminId)return res.status(403).json({error:"Not allowed."});const body=clean(req.body.body,1000);if(!body)return res.status(400).json({error:"Comment is empty."});await dbRun("UPDATE comments SET body=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[body,Number(req.params.id)]);res.json({ok:true})});
  app.delete("/api/comments/:id",requireLogin,writeLimiter,async(req,res)=>{const c=await dbGet("SELECT user_id FROM comments WHERE id=?",[Number(req.params.id)]);if(!c)return res.status(404).json({error:"Comment not found."});if(c.user_id!==req.session.userId&&!req.session.adminId)return res.status(403).json({error:"Not allowed."});await dbRun("DELETE FROM comments WHERE id=?",[Number(req.params.id)]);res.json({ok:true})});
  app.post("/api/posts/:id/share",requireLogin,writeLimiter,async(req,res)=>{const id=Number(req.params.id);await dbRun("INSERT INTO post_shares(post_id,user_id) VALUES(?,?)",[id,req.session.userId]);const n=await dbGet("SELECT COUNT(*) count FROM post_shares WHERE post_id=?",[id]);res.json({count:Number(n?.count||0),url:`${req.protocol}://${req.get("host")}/?post=${id}`})});

  app.get("/api/admin/posts",requireLogin,requireAdmin,async(req,res)=>res.json(await dbAll(`SELECT p.id,p.body,p.created_at,u.username,pr.student_name FROM posts p JOIN users u ON u.id=p.user_id LEFT JOIN profiles pr ON pr.user_id=p.user_id ORDER BY p.created_at DESC LIMIT 200`)));
  app.get("/api/admin/comments",requireLogin,requireAdmin,async(req,res)=>res.json(await dbAll(`SELECT c.id,c.body,c.created_at,u.username,p.student_name FROM comments c JOIN users u ON u.id=c.user_id LEFT JOIN profiles p ON p.user_id=c.user_id ORDER BY c.created_at DESC LIMIT 200`)));
  app.delete("/api/admin/posts/:id",requireLogin,requireAdmin,async(req,res)=>{await dbRun("DELETE FROM posts WHERE id=?",[Number(req.params.id)]);res.json({ok:true})});
  app.delete("/api/admin/comments/:id",requireLogin,requireAdmin,async(req,res)=>{await dbRun("DELETE FROM comments WHERE id=?",[Number(req.params.id)]);res.json({ok:true})});
  app.get("/api/admin/stats",requireLogin,requireAdmin,async(req,res)=>{const [u,p,c,l]=await Promise.all([dbGet("SELECT COUNT(*) count FROM users"),dbGet("SELECT COUNT(*) count FROM posts"),dbGet("SELECT COUNT(*) count FROM comments"),dbGet("SELECT COUNT(*) count FROM post_likes")]);res.json({users:Number(u?.count||0),posts:Number(p?.count||0),comments:Number(c?.count||0),likes:Number(l?.count||0)})});
  setInterval(async()=>{try{await dbRun("DELETE FROM sessions WHERE expires_at <= ?",[Date.now()])}catch{}},15*60*1000).unref();
  app.listen(PORT,HOST,()=>console.log(`SCI J running on ${PORT} (${USE_POSTGRES?"Postgres":"SQLite fallback"})`));
}
start().catch(e=>{console.error("Fatal startup",e);process.exit(1)});