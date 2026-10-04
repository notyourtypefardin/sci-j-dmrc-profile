(()=>{const css=`.social-tools{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.social-btn{background:#ffffff08!important;border:1px solid #ffffff12!important;color:#d9dbe0!important;border-radius:999px!important;padding:8px 12px!important}.social-btn.liked{color:#ff5660!important;background:#ed1c2415!important;border-color:#ed1c2440!important}.post-menu{position:relative;display:inline-block}.post-menu-panel{display:none;position:absolute;right:0;top:34px;z-index:20;width:150px;padding:6px;border-radius:14px;background:#11141aee;border:1px solid #ffffff1c;box-shadow:0 18px 45px #000b}.post-menu-panel.show{display:block}.post-menu-panel button{display:block;width:100%;text-align:left;background:transparent!important;box-shadow:none!important}.visitor-card{position:fixed;inset:0;z-index:180;display:none;align-items:center;justify-content:center;padding:18px;background:#000c}.visitor-card.show{display:flex}.visitor-inner{width:min(900px,96vw);max-height:90vh;overflow:auto;padding:20px;border-radius:26px}.visitor-head{display:flex;gap:14px;align-items:center}.visitor-head .mini-avatar{width:72px;height:72px}.profile-search-result{display:flex;align-items:center;gap:10px;padding:10px;border-top:1px solid #ffffff0c;cursor:pointer}.profile-search-result:hover{background:#ffffff08}.comment-row{display:flex;gap:8px;align-items:flex-start;padding:9px 0;border-bottom:1px solid #ffffff0b}.comment-row .comment-text{flex:1}.profile-posts-title{margin-top:25px;color:#ff6670;font-size:12px;letter-spacing:2px;text-transform:uppercase}`;const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
// Navigation is owned by the redesigned search/navigation controller below.
function esc2(s){return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
window.openVisitor=async function(username){const r=await fetch('/api/profile/'+encodeURIComponent(username)),d=await r.json();if(!r.ok)return alert(d.error||'Profile unavailable');const p=d.profile;let rows=[['Roll Number',p.roll_number],['Class',p.class_name],['Group',p.group_name],['Board',p.board],['Role',d.role||'STUDENT']];if(p.father_name)rows.push(['Father',p.father_name]);if(p.mother_name)rows.push(['Mother',p.mother_name]);if(p.contact)rows.push(['Contact',p.contact]);if(p.address)rows.push(['Address',p.address]);let modal=document.getElementById('upgradeVisitor');if(!modal){modal=document.createElement('div');modal.id='upgradeVisitor';modal.className='visitor-card';document.body.appendChild(modal)}modal.innerHTML='<div class="visitor-inner glass"><button class="alt" style="float:right" onclick="this.closest(\'.visitor-card\').classList.remove(\'show\')">×</button><div class="visitor-head"><div class="mini-avatar">'+(p.avatar_data?'<img src="'+p.avatar_data+'">':esc2((p.student_name||'D')[0]))+'</div><div><h2 style="margin:0">'+esc2(p.student_name)+'</h2><div class="muted">@'+esc2(d.user.username)+'</div></div></div><div class="profile-grid" style="margin-top:18px">'+rows.map(x=>'<div class="info"><b>'+esc2(x[0])+'</b><span>'+esc2(x[1]||'—')+'</span></div>').join('')+'</div><div class="profile-posts-title">Posts by this student</div><div class="upgrade-visitor-posts">'+(d.posts.length?d.posts.map(p=>window.postHTML(p)).join(''):'<div class="empty">No posts yet.</div>')+'</div></div>';modal.classList.add('show');modal.querySelectorAll('.post').forEach((el,i)=>addSocialToPost(el,d.posts[i]))};
function addSocialToPost(article,p){if(!article||!p||article.dataset.upgraded)return;article.dataset.upgraded='1';const old=article.querySelector('.post-head');if(!old)return;const username=article.querySelector('.author-user');if(username){username.style.cursor='pointer';username.onclick=()=>openVisitor(p.username)}let actions=document.createElement('div');actions.className='social-tools';actions.innerHTML='<button class="social-btn heart '+(p.liked?'liked':'')+'">♥ <span>'+Number(p.like_count||0)+'</span></button><button class="social-btn comment">◯ <span>'+Number(p.comment_count||0)+'</span></button><button class="social-btn share">➤ <span>'+Number(p.share_count||0)+'</span></button>';article.appendChild(actions);actions.querySelector('.heart').onclick=async()=>{const r=await fetch('/api/posts/'+p.id+'/like',{method:'POST'}),d=await r.json();if(r.ok){actions.querySelector('.heart').classList.toggle('liked',d.liked);actions.querySelector('.heart span').textContent=d.count}};actions.querySelector('.share').onclick=async()=>{const r=await fetch('/api/posts/'+p.id+'/share',{method:'POST'}),d=await r.json();if(r.ok){try{await navigator.clipboard.writeText(d.url);alert('Share link copied')}catch{alert(d.url)}actions.querySelector('.share span').textContent=d.count}};actions.querySelector('.comment').onclick=()=>loadUpgradeComments(article,p.id);
const own=me&&Number(p.user_id)===Number(me.user.id),menu=document.createElement('div');menu.className='post-menu';menu.innerHTML='<button class="alt" style="padding:5px 9px">⋯</button><div class="post-menu-panel">'+(own?'<button data-edit>✎ Edit</button><button data-delete>⌫ Delete</button>':'')+'<button data-details>ⓘ Details</button></div>';old.appendChild(menu);menu.querySelector('button').onclick=()=>menu.querySelector('.post-menu-panel').classList.toggle('show');if(own){menu.querySelector('[data-edit]').onclick=()=>{const b=prompt('Edit post',p.body||'');if(b!==null)fetch('/api/posts/'+p.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:b})}).then(()=>loadPosts())};menu.querySelector('[data-delete]').onclick=()=>{if(confirm('Delete this post?'))fetch('/api/posts/'+p.id,{method:'DELETE'}).then(()=>loadPosts())}}menu.querySelector('[data-details]').onclick=()=>alert('Uploaded by @'+p.username+'\\nCreated: '+new Date(p.created_at).toLocaleString()+'\\nUpdated: '+new Date(p.updated_at).toLocaleString())}
async function loadUpgradeComments(article,id){let box=article.querySelector('.upgrade-comments');if(!box){box=document.createElement('div');box.className='upgrade-comments';article.appendChild(box)}const r=await fetch('/api/posts/'+id+'/comments'),a=await r.json();box.innerHTML='<div style="margin-top:8px">'+(a.length?a.map(c=>'<div class="comment-row"><div class="comment-text"><small>@'+esc2(c.username)+' · '+new Date(c.created_at).toLocaleString()+'</small><div>'+esc2(c.body)+'</div></div>'+(Number(c.user_id)===Number(me.user.id)?'<button class="alt" style="padding:5px" data-c="'+c.id+'">⌫</button>':'')+'</div>').join(''):'<div class="muted">No comments yet.</div>')+'</div><div style="display:flex;gap:7px;margin-top:8px"><input class="upgrade-comment-input" placeholder="Write a comment"><button class="social-btn">Send</button></div>';box.querySelector('button:last-child').onclick=async()=>{const i=box.querySelector('input');if(!i.value.trim())return;await fetch('/api/posts/'+id+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({body:i.value.trim()})});loadUpgradeComments(article,id)};box.querySelectorAll('[data-c]').forEach(b=>b.onclick=async()=>{if(confirm('Delete comment?')){await fetch('/api/comments/'+b.dataset.c,{method:'DELETE'});loadUpgradeComments(article,id)}})}
window.renderProfileExtras=async function(){if(!me?.profile)return;document.getElementById('profileRole')?.classList.toggle('profile-role-admin',!!me.admin);const sec=document.querySelector('#profilePage .profile-content');if(!sec||sec.querySelector('.privacy-enhanced'))return;const wrap=document.createElement('div');wrap.className='privacy-enhanced';wrap.innerHTML='<div class="profile-posts-title">Privacy controls</div><div class="privacy">Your private fields are enforced server-side; visitors can never edit your profile.</div>';sec.appendChild(wrap)};
const oldLoadPosts=window.loadPosts;window.loadPosts=async function(){await oldLoadPosts();const r=await fetch('/api/posts');if(!r.ok)return;const posts=await r.json();document.querySelectorAll('.post').forEach((el,i)=>addSocialToPost(el,posts[i]))};
window.addEventListener('load',()=>{setTimeout(()=>{if(me)renderProfileExtras();loadPosts()},900)});
})();
/* Redesigned glass search experience */
(()=>{
const style=document.createElement('style');
style.textContent=`
.search-shell{min-height:calc(100vh - 88px);padding:26px 16px 125px;position:relative;overflow:hidden}
.search-shell:before{content:"";position:absolute;inset:-35px;background:var(--campus-bg) center/cover no-repeat;filter:blur(20px) brightness(.42) saturate(1.08);transform:scale(1.08);opacity:.9}
.search-shell:after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 8%,#ed1c2420,transparent 38%),linear-gradient(180deg,#05070a55,#05070af2)}
.search-panel{position:relative;z-index:2;width:min(760px,100%);margin:0 auto;padding:24px;border:1px solid #ffffff16;border-radius:30px;background:linear-gradient(145deg,#ffffff0d,#ffffff04);box-shadow:0 28px 80px #0008,inset 0 1px 0 #ffffff12;backdrop-filter:blur(18px) saturate(125%);-webkit-backdrop-filter:blur(18px) saturate(125%)}
.search-brand{display:flex;align-items:center;gap:13px;margin-bottom:22px}
.search-brand-icon{width:44px;height:44px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(145deg,#ed1c24,#8d0e14);box-shadow:0 10px 28px #ed1c2438}
.search-brand-icon svg{width:22px;height:22px;fill:none;stroke:#fff;stroke-width:2}
.search-eyebrow{font-size:10px;letter-spacing:3px;color:#ff6870;font-weight:900;text-transform:uppercase}
.search-heading{margin:3px 0 0;font-size:27px;letter-spacing:-.5px;color:#fff}
.search-subtitle{margin:5px 0 0;color:#969ca7;font-size:12px}
.search-input-wrap{position:relative}
.search-input-wrap:focus-within{filter:drop-shadow(0 10px 25px #ed1c2410)}
.search-input-icon{position:absolute;left:17px;top:50%;transform:translateY(-50%);pointer-events:none}
.search-input-icon svg{width:20px;height:20px;fill:none;stroke:#aeb3bd;stroke-width:2}
.search-input{width:100%;box-sizing:border-box;padding:16px 48px 16px 48px;border-radius:18px;border:1px solid #ffffff18;background:#05070ac9;color:#fff;outline:0;font-size:15px;transition:border .25s,box-shadow .25s,background .25s}
.search-input:focus{border-color:#ed1c2466;background:#07090dcc;box-shadow:0 0 0 4px #ed1c2412,0 14px 35px #0005}
.search-clear{position:absolute;right:9px;top:50%;transform:translateY(-50%);width:34px;height:34px;border:0;border-radius:50%;background:#ffffff0b;color:#b9bec7;cursor:pointer;display:none}
.search-clear.show{display:block}
.search-hint{display:flex;justify-content:space-between;gap:10px;margin:9px 4px 0;color:#777e89;font-size:10px}
.search-results{margin-top:18px;display:grid;gap:8px}
.search-status{text-align:center;padding:28px 12px;color:#8e949e;font-size:12px}
.search-result{display:flex;align-items:center;gap:13px;padding:13px;border-radius:18px;border:1px solid #ffffff0e;background:linear-gradient(135deg,#ffffff0a,#ffffff03);cursor:pointer;transition:transform .28s cubic-bezier(.22,1,.36,1),background .28s,border .28s,box-shadow .28s}
.search-result:hover{transform:translateY(-2px);background:#ffffff0d;border-color:#ffffff1c;box-shadow:0 14px 35px #0005}
.search-result.exact{border-color:#ed1c2450;background:linear-gradient(135deg,#ed1c2418,#ffffff05)}
.search-result-avatar{width:48px;height:48px;flex:0 0 48px;border-radius:15px;overflow:hidden;display:grid;place-items:center;background:#181c23;border:1px solid #ffffff14;color:#fff;font-weight:900}
.search-result-avatar img{width:100%;height:100%;object-fit:cover}
.search-result-main{min-width:0;flex:1}
.search-result-name{font-size:14px;font-weight:800;color:#f5f6f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.search-result-meta{margin-top:4px;color:#9298a3;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.search-result-arrow{color:#777e89;font-size:18px;transition:transform .25s,color .25s}
.search-result:hover .search-result-arrow{transform:translateX(3px);color:#ff5b63}
.search-exact{font-size:8px;letter-spacing:1.5px;color:#ff6870;font-weight:900;margin-top:5px}
.search-count{margin-top:14px;color:#6f7580;font-size:10px;text-align:center}
@media(max-width:600px){.search-shell{padding:16px 12px 115px}.search-panel{padding:18px;border-radius:24px}.search-heading{font-size:23px}.search-result{padding:11px}.search-result-avatar{width:44px;height:44px;flex-basis:44px;border-radius:14px}}
`;
document.head.appendChild(style);

function ensureSearchPage(){
  if(document.getElementById('searchPage'))return;
  const m=document.createElement('main');
  m.id='searchPage';m.className='page';
  m.innerHTML=`<div class="search-shell">
    <section class="search-panel">
      <div class="search-brand">
        <div class="search-brand-icon"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.2"></circle><path d="m16 16 5 5"></path></svg></div>
        <div><div class="search-eyebrow">DMRC DIRECTORY</div><h1 class="search-heading">Find a Student</h1><div class="search-subtitle">Search by username, roll number, ID or name</div></div>
      </div>
      <div class="search-input-wrap">
        <span class="search-input-icon"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.2"></circle><path d="m16 16 5 5"></path></svg></span>
        <input id="navSearchInput" class="search-input" autocomplete="off" spellcheck="false" placeholder="Type username, roll, ID or name…">
        <button id="navSearchClear" class="search-clear" aria-label="Clear search">×</button>
      </div>
      <div class="search-hint"><span>Exact matches open instantly</span><span>Minimum 2 characters</span></div>
      <div id="navSearchResults" class="search-results"><div class="search-status">Start typing to find a DMRC student.</div></div>
    </section>
  </div>`;
  document.getElementById('profilePage')?.before(m);
}

function bindSearch(){
  ensureSearchPage();
  const input=document.getElementById('navSearchInput'),out=document.getElementById('navSearchResults'),clear=document.getElementById('navSearchClear');
  if(!input||input.dataset.bound)return;
  input.dataset.bound='1';
  let timer=0,lastQuery='';
  const render=(items,q)=>{
    if(!items.length){out.innerHTML='<div class="search-status">No matching profile found.</div>';return}
    const exact=items.find(x=>String(x.username).toLowerCase()===q.toLowerCase()||String(x.roll_number||'').toLowerCase()===q.toLowerCase()||String(x.user_id||'')===q);
    out.innerHTML=items.map(x=>{
      const isExact=exact&&String(x.username)===String(exact.username);
      const initial=esc2((x.student_name||x.username||'D')[0]);
      return '<div class="search-result '+(isExact?'exact':'')+'" data-u="'+esc2(x.username)+'">'+
        '<div class="search-result-avatar">'+(x.avatar_data?'<img src="'+esc2(x.avatar_data)+'" alt="">':initial)+'</div>'+
        '<div class="search-result-main"><div class="search-result-name">'+esc2(x.student_name||x.username)+'</div>'+
        '<div class="search-result-meta">'+esc2(x.role||'STUDENT')+' · @'+esc2(x.username)+' · Roll '+esc2(x.roll_number||'—')+'</div>'+
        (isExact?'<div class="search-exact">EXACT MATCH · OPEN PROFILE</div>':'')+
        '</div><div class="search-result-arrow">›</div></div>';
    }).join('');
    out.querySelectorAll('[data-u]').forEach(el=>el.onclick=()=>openVisitor(el.dataset.u));
    const exactItem=out.querySelector('.search-result.exact');
    if(exactItem){clear.classList.add('show')}
    const exactUser=items.find(x=>String(x.username).toLowerCase()===q.toLowerCase()||String(x.roll_number||'').toLowerCase()===q.toLowerCase()||String(x.user_id||'')===q);
    if(exactUser)openVisitor(exactUser.username);
  };
  input.oninput=()=>{
    clearTimeout(timer);const q=input.value.trim();clear.classList.toggle('show',!!q);
    if(q.length<2){out.innerHTML='<div class="search-status">Start typing to find a DMRC student.</div>';return}
    out.innerHTML='<div class="search-status">Searching…</div>';
    timer=setTimeout(async()=>{
      if(q===lastQuery)return;lastQuery=q;
      try{
        const r=await fetch('/api/profile/search?q='+encodeURIComponent(q),{cache:'no-store'}),a=await r.json();
        render(a,q);
      }catch{out.innerHTML='<div class="search-status">Search failed. Please try again.</div>'}
    },180);
  };
  clear.onclick=()=>{input.value='';lastQuery='';clear.classList.remove('show');out.innerHTML='<div class="search-status">Start typing to find a DMRC student.</div>';input.focus()};
}

let navPage='home';
window.showPage=function(name){
  bindSearch();
  const next=document.getElementById(name+'Page');if(!next)return;
  if(navPage===name){window.scrollTo({top:0,behavior:'smooth'});if(name==='ai')window.aiLoad?.();if(name==='search')document.getElementById('navSearchInput')?.focus({preventScroll:true});return}
  const order={home:0,search:1,profile:2,ai:3};
  const dir=(order[name]??0)>(order[navPage]??0)?'left':'right';
  const prev=document.getElementById(navPage+'Page');
  if(prev)prev.classList.remove('active');
  next.classList.remove('search-in-left','search-in-right');void next.offsetWidth;
  next.classList.add('active','search-in-'+dir);
  document.getElementById('homeNav')?.classList.toggle('active',name==='home');
  document.getElementById('profileSearchNav')?.classList.toggle('active',name==='search');
  document.getElementById('profileNav')?.classList.toggle('active',name==='profile');
  document.getElementById('aiNav')?.classList.toggle('active',name==='ai');
  document.querySelector('.nav')?.style.setProperty('--nav-index',String(order[name]??0));
  navPage=name;window.scrollTo({top:0,behavior:'smooth'});
  if(name==='search')setTimeout(()=>document.getElementById('navSearchInput')?.focus({preventScroll:true}),140);
  if(name==='profile')setTimeout(()=>window.renderProfileExtras?.(),120);
  if(name==='ai')setTimeout(()=>window.aiLoad?.(),120);
};
ensureSearchPage();
window.addEventListener('load',bindSearch);
})();
/* Admin-only Creator Introduction manager */
(()=>{const $=id=>document.getElementById(id);let creatorImageData=null;let crop={x:50,y:50,zoom:1};
function applyCrop(img,c){if(!img)return;const x=Number(c?.x??50),y=Number(c?.y??50),z=Number(c?.zoom??1);img.style.objectFit='cover';img.style.width=(z*100)+'%';img.style.height=(z*100)+'%';img.style.maxWidth='none';img.style.maxHeight='none';img.style.transform='translate('+((50-x)*0.35)+'%,'+((50-y)*0.35)+'%)'}
async function loadCreatorIntro(){try{const r=await fetch('/api/creator-intro',{cache:'no-store'});if(!r.ok)return;const x=await r.json();$('creatorText').textContent=x.creator_text||'';try{crop=typeof x.creator_crop==='string'?JSON.parse(x.creator_crop):(x.creator_crop||crop)}catch{}const img=$('creatorAvatarImg'),wrap=$('creatorAvatar');if(x.creator_image_data){img.src=x.creator_image_data;img.style.display='block';wrap?.classList.add('has');applyCrop(img,crop)}else{img.removeAttribute('src');img.style.display='none';wrap?.classList.remove('has')}if(me?.admin){$('creatorEditBtn')?.style.setProperty('display','inline-flex');$('creatorImageEditBtn')?.style.setProperty('display','block')}}catch{}}
window.openCreatorEditor=async()=>{if(!me?.admin)return;await loadCreatorIntro();$('creatorAdminText').value=$('creatorText').textContent||'';creatorImageData=$('creatorAvatarImg').src||null;$('creatorAdminPreview').src=creatorImageData||'';$('creatorCropZoom').value=crop.zoom;$('creatorCropX').value=crop.x;$('creatorCropY').value=crop.y;applyCrop($('creatorAdminPreview'),crop);$('creatorAdminPanel').classList.add('show')};
window.closeCreatorEditor=()=>{$('creatorAdminPanel')?.classList.remove('show')};
function updateCrop(){crop={x:Number($('creatorCropX').value),y:Number($('creatorCropY').value),zoom:Number($('creatorCropZoom').value)};applyCrop($('creatorAdminPreview'),crop)}
['creatorCropZoom','creatorCropX','creatorCropY'].forEach(id=>$(id)?.addEventListener('input',updateCrop));
$('creatorAdminImage')?.addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;if(!f.type.startsWith('image/'))return alert('Select an image.');if(f.size>6*1024*1024)return alert('Image must be under 6 MB.');const rd=new FileReader();rd.onload=()=>{creatorImageData=rd.result;crop={x:50,y:50,zoom:1};$('creatorCropZoom').value=1;$('creatorCropX').value=50;$('creatorCropY').value=50;$('creatorAdminPreview').src=creatorImageData;applyCrop($('creatorAdminPreview'),crop)};rd.readAsDataURL(f)});
window.saveCreatorIntro=async()=>{if(!me?.admin)return alert('Admin access required.');const r=await fetch('/api/admin/creator-intro',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({creator_text:$('creatorAdminText').value,creator_image_data:creatorImageData,creator_crop:crop})});const x=await r.json();if(!r.ok)return alert(x.error||'Update failed.');window.closeCreatorEditor();loadCreatorIntro()};
window.addEventListener('load',()=>{loadCreatorIntro();let n=0;const t=setInterval(()=>{if(me){if(me.admin){$('creatorEditBtn')?.style.setProperty('display','inline-flex');$('creatorImageEditBtn')?.style.setProperty('display','block')}clearInterval(t)}if(++n>40)clearInterval(t)},250)})})();
/* Creator crop + portrait final overrides */
(()=>{const s=document.createElement('style');s.textContent=".creator-avatar{width:176px!important;height:176px!important;flex-basis:176px!important;border-radius:50%!important;overflow:hidden!important;background:#080a0f!important;border:2px solid #ffffff18!important}.creator-media{flex:0 0 190px!important;width:190px!important;height:190px!important}.crop-preview{width:170px!important;height:170px!important;border-radius:50%!important;overflow:hidden!important;display:grid;place-items:center}.creator-crop-controls{display:grid;gap:8px;margin-top:10px}.creator-crop-controls label{font-size:11px;color:#bfc3cb}.creator-crop-controls input[type=range]{width:100%;accent-color:#ed1c24}@media(max-width:600px){.creator-intro{padding:24px 18px 22px!important;gap:15px!important}.creator-media{flex:0 0 178px!important;width:178px!important;height:178px!important}.creator-avatar{width:164px!important;height:164px!important;flex-basis:164px!important}.crop-preview{width:150px!important;height:150px!important}}";document.head.appendChild(s)})();
/* Creator card final mobile/desktop layout */
(()=>{const s=document.createElement('style');s.textContent=".creator-intro{width:min(900px,92%);margin:22px auto 130px;padding:28px 26px;border-radius:28px;display:flex;align-items:center;gap:24px;min-height:190px;box-sizing:border-box}.creator-media{position:relative;flex:0 0 162px;width:162px;height:162px;display:grid;place-items:center}.creator-avatar{width:150px;height:150px;flex:0 0 150px;border-radius:50%;overflow:hidden;border:2px solid #ffffff20;background:#080a0f;display:grid;place-items:center;box-shadow:0 16px 38px #0008,inset 0 1px 0 #ffffff18}.creator-avatar img{width:125%;height:125%;max-width:none;max-height:none;object-fit:cover;object-position:center 82%;transform:translateY(4%)}.creator-image-edit-btn{position:absolute;right:1px;bottom:1px;width:30px;height:30px;border:1px solid #ffffff45;border-radius:50%;background:#ed1c24;color:#fff;font-size:13px;line-height:30px;padding:0;box-shadow:0 7px 18px #0009;z-index:5}.creator-copy{min-width:0;flex:1;display:flex;flex-direction:column;align-items:flex-start}.creator-kicker{font-size:10px;letter-spacing:2.5px;font-weight:900;color:#ff6670;text-transform:uppercase;margin-bottom:8px}.creator-text{font-size:15px;line-height:1.65;color:#e9eaed;max-width:620px}.creator-edit-btn{margin-top:15px;display:none;align-items:center;justify-content:center;background:#ed1c24;border:1px solid #ff667055;border-radius:999px;padding:9px 15px;font-size:11px;color:#fff;cursor:pointer}.creator-signature-wrap{margin-top:8px!important}.creator-signature{width:112px!important}.creator-signature-label{font-size:7px!important}@media(max-width:600px){.creator-intro{width:min(92%,430px);margin:18px auto 125px;padding:22px 18px 20px;border-radius:24px;min-height:0;display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}.creator-media{flex:0 0 148px;width:148px;height:148px}.creator-avatar{width:138px;height:138px;flex-basis:138px;border-radius:50%}.creator-image-edit-btn{right:0;bottom:0;width:29px;height:29px;line-height:29px}.creator-copy{width:100%;flex:none;align-items:center}.creator-kicker{font-size:8px;letter-spacing:1.8px;margin-bottom:7px}.creator-text{font-size:13px;line-height:1.58}.creator-edit-btn{margin-top:12px;padding:8px 13px;font-size:10px}.creator-signature-wrap{margin-top:2px!important}.creator-signature{width:104px!important}.creator-signature-label{font-size:6.5px!important}}";document.head.appendChild(s)})();
/* Creator signature */
(()=>{
  const css=document.createElement('style');
  css.textContent='.creator-signature{display:block;width:min(112px,32vw);height:auto;margin:2px auto 0;filter:brightness(0) invert(1) drop-shadow(0 3px 8px #0008);opacity:.96;object-fit:contain}.creator-signature-wrap{margin-top:5px;text-align:center;flex:0 0 auto}.creator-signature-label{font-size:7px;letter-spacing:1.2px;text-transform:uppercase;color:#8f949e;margin-bottom:1px}@media(max-width:600px){.creator-intro{width:min(92%,430px);margin:18px auto 125px;padding:18px 16px;border-radius:22px;min-height:0;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}.creator-avatar{width:62px;height:62px;flex-basis:62px;border-width:2px}.creator-copy{width:100%;flex:none}.creator-kicker{font-size:8px;letter-spacing:1.8px;margin-bottom:6px}.creator-text{font-size:13px;line-height:1.55}.creator-edit-btn{padding:8px 13px;font-size:10px}.creator-signature-wrap{margin-top:1px}.creator-signature{width:112px}.creator-signature-label{font-size:6.5px;letter-spacing:1px}.creator-admin-card{width:min(100%,430px);padding:18px;border-radius:20px}.creator-admin-panel{padding:12px}.creator-admin-card textarea{min-height:110px}}';
  document.head.appendChild(css);
  function addSignature(){
    const card=document.querySelector('.creator-intro');
    if(!card||card.querySelector('.creator-signature-wrap'))return;
    const wrap=document.createElement('div');
    wrap.className='creator-signature-wrap';
    wrap.innerHTML='<div class="creator-signature-label">Siuuu • Creator Signature</div><img class="creator-signature" src="/signature.svg?v=3" alt="Siuuu creator signature" loading="eager" decoding="async">';
    card.appendChild(wrap);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addSignature);else addSignature();
  window.addEventListener('load',addSignature);
})();
