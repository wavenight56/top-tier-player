const $ = s => document.querySelector(s);
const state = { mode:'xtream', profile:null, page:'home', items:{live:[],movies:[],series:[],catchup:[]}, favorites:JSON.parse(localStorage.getItem('tt-favorites')||'[]'), recent:JSON.parse(localStorage.getItem('tt-recent')||'[]'), unlocked:false };
const proxy = url => `/api/proxy?url=${encodeURIComponent(url)}`;
const toast = msg => { const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2500); };
const cleanBase = value => { const u=new URL(value.trim()); if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error('Enter a complete http:// or https:// server address'); return u.origin+u.pathname.replace(/\/+$/,'').replace(/\/(player_api|get)\.php$/,''); };
const esc = value => String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

document.querySelectorAll('.mode').forEach(btn=>btn.onclick=()=>{
  state.mode=btn.dataset.mode; document.querySelectorAll('.mode').forEach(b=>b.classList.toggle('active',b===btn));
  $('#xtreamFields').hidden=state.mode!=='xtream'; $('#m3uFields').hidden=state.mode!=='m3u';
});

$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault(); const submit=e.submitter||$('#loginForm button[type=submit]'); submit.disabled=true; submit.textContent='CONNECTING…';
  try{ state.mode==='xtream'?await connectXtream():await connectM3u(); showApp(); }catch(err){toast(err.message||'Connection failed')}finally{submit.disabled=false;submit.textContent='CONNECT'}
});

async function getText(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);try{const r=await fetch(proxy(url),{signal:controller.signal,cache:'no-store'});if(!r.ok){let data;try{data=await r.json()}catch{}throw new Error(data?.error||`Provider returned ${r.status}`)}return await r.text()}catch(e){if(e.name==='AbortError')throw new Error('The provider took too long to respond. Please retry.');throw e}finally{clearTimeout(timer)}}
async function getJson(url){const text=await getText(url);try{return JSON.parse(text)}catch{throw new Error('The server did not return a valid provider response. Check the server URL.')}}
function apiUrl(action,extra={}){const p=state.profile;const q=new URLSearchParams({username:p.username,password:p.password,action,...extra});return `${p.base}/player_api.php?${q}`}

async function connectXtream(){
  const base=cleanBase($('#serverUrl').value),username=$('#username').value.trim(),password=$('#password').value;
  if(!base||!username||!password)throw new Error('Enter server URL, username and password');
  const auth=await getJson(`${base}/player_api.php?${new URLSearchParams({username,password})}`);
  if(String(auth?.user_info?.auth)!=='1')throw new Error('Provider rejected this login');
  state.profile={type:'xtream',base,username,password,user:auth.user_info,server:auth.server_info};
  const results=await Promise.allSettled(['get_live_streams','get_vod_streams','get_series','get_live_categories','get_vod_categories','get_series_categories'].map(action=>getJson(apiUrl(action))));
  if(results.slice(0,3).every(r=>r.status==='rejected'))throw new Error('Login accepted, but no catalogs could load. Please retry.');
  const [live,movies,series]=results.slice(0,3).map(r=>r.status==='fulfilled'&&Array.isArray(r.value)?r.value:[]);
  state.categories={};['live','movie','series'].forEach((type,i)=>{const r=results[i+3];state.categories[type]=Object.fromEntries((r.status==='fulfilled'&&Array.isArray(r.value)?r.value:[]).map(c=>[String(c.category_id),c.category_name]));});
  if(results.slice(0,3).some(r=>r.status==='rejected'))toast('Some catalogs could not load. Reconnect to retry them.');
  state.items.live=(live||[]).map(x=>normalizeXtream(x,'live'));
  state.items.movies=(movies||[]).map(x=>normalizeXtream(x,'movie'));
  state.items.series=(series||[]).map(x=>normalizeXtream(x,'series'));
  state.items.catchup=state.items.live.filter(x=>x.catchup);
}
function normalizeXtream(x,type){
  const id=x.stream_id||x.series_id; const p=state.profile; let url='';
  if(type==='live')url=`${p.base}/live/${encodeURIComponent(p.username)}/${encodeURIComponent(p.password)}/${id}.m3u8`;
  if(type==='movie')url=`${p.base}/movie/${encodeURIComponent(p.username)}/${encodeURIComponent(p.password)}/${id}.${x.container_extension||'mp4'}`;
  return{id:String(id),name:x.name||x.title||'Untitled',type,category:state.categories?.[type]?.[String(x.category_id)]||String(x.category_id||''),icon:x.stream_icon||x.cover||'',url,catchup:String(x.tv_archive)==='1',rating:x.rating_5based||x.rating||'',raw:x};
}
async function connectM3u(){
  const playlist=$('#m3uUrl').value.trim(); if(!playlist)throw new Error('Enter an M3U playlist URL');
  const text=await getText(playlist); const items=parseM3u(text); if(!items.length)throw new Error('No playable items found');
  state.profile={type:'m3u',playlist,epg:$('#epgUrl').value.trim(),user:{status:'Active'}}; state.items.live=items; state.items.catchup=items.filter(x=>x.catchup);
  state.items.movies=items.filter(x=>/movie|vod/i.test(x.category)); state.items.series=items.filter(x=>/series|show/i.test(x.category));
}
function parseM3u(text){
  const lines=text.split(/\r?\n/),out=[];let meta=null;
  for(const line of lines){if(line.startsWith('#EXTINF:')){const attrs={};for(const m of line.matchAll(/([\w-]+)="([^"]*)"/g))attrs[m[1]]=m[2];meta={name:line.split(',').slice(1).join(',').trim()||attrs['tvg-name'],attrs};}else if(meta&&line.trim()&&!line.startsWith('#')){const a=meta.attrs;out.push({id:a['tvg-id']||String(out.length),name:meta.name||'Untitled',type:'live',category:a['group-title']||'Other',icon:a['tvg-logo']||'',url:line.trim(),catchup:Boolean(a['catchup']||a['catchup-source']),raw:{}});meta=null;}}
  return out;
}

function showApp(){
  $('#login').hidden=true;$('#app').hidden=false;const u=state.profile.user||{};let status=u.status||'Connected';
  if(u.exp_date){const d=new Date(Number(u.exp_date)*1000);status+=` • Expires ${d.toLocaleDateString()}`}
  $('#accountStatus').textContent=status; navigate('home');
}
document.querySelectorAll('#nav button').forEach(b=>b.onclick=()=>navigate(b.dataset.page));
function navigate(page){state.page=page;document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('#pageTitle').textContent=({home:'Home',live:'Live TV',movies:'Movies',series:'TV Series',catchup:'Catch Up',favorites:'Favorites',settings:'Settings'})[page];render();}
function render(){
  if(state.page==='home')return renderHome();if(state.page==='settings')return renderSettings();
  const items=state.page==='favorites'?allItems().filter(x=>state.favorites.includes(key(x))):state.items[state.page]||[];renderBrowser(items);
}
function renderHome(){
  const recent=state.recent.map(k=>allItems().find(x=>key(x)===k)).filter(Boolean).slice(0,8);
  $('#content').innerHTML=`<section class="hero"><p>WELCOME TO</p><h3>TOP TIER ENTERTAINMENT</h3><span class="muted">${state.items.live.length} live channels • ${state.items.movies.length} movies • ${state.items.series.length} series</span></section><div class="section-title"><h3>Recently Watched</h3></div>${cards(recent)||'<div class="empty">Your recently watched channels will appear here.</div>'}`;bindCards();
}
function isRestricted(x){return /adult|xxx|18\+/i.test(String(x.category||'')+' '+String(x.name||''))}
function renderBrowser(items){
  if(!state.unlocked)items=items.filter(x=>!isRestricted(x));
  const categories=[...new Set(items.map(x=>x.category).filter(Boolean))];
  $('#content').innerHTML=`<div class="toolbar"><input id="search" placeholder="Search ${esc($('#pageTitle').textContent)}"><select id="category"><option value="">All categories</option>${categories.map(c=>`<option>${esc(c)}</option>`).join('')}</select></div><div id="results">${cards(items)||'<div class="empty">Nothing available in this section.</div>'}</div>`;
  const update=()=>{const q=$('#search').value.toLowerCase(),c=$('#category').value;const filtered=items.filter(x=>(!q||x.name.toLowerCase().includes(q))&&(!c||x.category===c));$('#results').innerHTML=cards(filtered)||'<div class="empty">No matches.</div>';bindCards()};
  $('#search').oninput=update;$('#category').onchange=update;bindCards();
}
function cards(items){return items.length?`<div class="grid">${items.map(x=>`<article class="card" data-key="${esc(key(x))}" tabindex="0" role="button">${x.catchup?'<span class="badge">CATCH UP</span>':''}<button class="fav" data-fav="${esc(key(x))}" aria-label="Favorite">${state.favorites.includes(key(x))?'★':'☆'}</button><h4>${esc(x.name)}</h4><p>${esc(x.category||x.type)}${x.rating?' • ★ '+esc(x.rating):''}</p></article>`).join('')}</div>`:''}
function bindCards(){document.querySelectorAll('.card').forEach(c=>{const open=e=>{if(e.target.closest('.fav'))return;const item=allItems().find(x=>key(x)===c.dataset.key);if(item)play(item)};c.onclick=open;c.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(e)}}});document.querySelectorAll('.fav').forEach(b=>b.onclick=e=>{e.stopPropagation();toggleFavorite(b.dataset.fav);render()})}
function allItems(){return [...state.items.live,...state.items.movies,...state.items.series]}
function key(x){return `${x.type}:${x.id}`}
function toggleFavorite(k){state.favorites=state.favorites.includes(k)?state.favorites.filter(x=>x!==k):[...state.favorites,k];localStorage.setItem('tt-favorites',JSON.stringify(state.favorites));toast('Favorites updated')}
function play(item){
  if(!state.unlocked&&isRestricted(item))return toast('Unlock parental controls to play this item.');
  if(item.type==='series')return openSeries(item);
  if(!item.url)return toast('No stream URL supplied');state.recent=[key(item),...state.recent.filter(x=>x!==key(item))].slice(0,20);localStorage.setItem('tt-recent',JSON.stringify(state.recent));
  if(window.TopTierNative?.play){window.TopTierNative.play(item.url,item.name);return}
  $('#nowPlaying').textContent=item.name;$('#playerMessage').textContent='';const video=$('#video');video.src=proxy(item.url);$('#playerDialog').showModal();video.play().catch(()=>{$('#playerMessage').textContent='Press Play to start. If playback fails, confirm the provider supports this stream format.'});
}
$('#closePlayer').onclick=()=>{$('#video').pause();$('#video').removeAttribute('src');$('#playerDialog').close()};
function renderSettings(){const pin=localStorage.getItem('tt-pin');$('#content').innerHTML=`<div class="panel" style="padding:24px;max-width:620px"><h3>Player Settings</h3><p class="muted">Content source: ${esc(state.profile.type.toUpperCase())}</p><label>Parental PIN<input id="newPin" type="password" inputmode="numeric" maxlength="6" placeholder="${pin?'PIN is set':'Create 4–6 digit PIN'}"></label><button id="savePin" class="primary">SAVE PIN</button><button id="logout" class="primary" style="background:#9d3040">DISCONNECT ACCOUNT</button></div>`;$('#savePin').onclick=()=>{const v=$('#newPin').value;if(!/^\d{4,6}$/.test(v))return toast('Use a 4–6 digit PIN');localStorage.setItem('tt-pin',v);toast('Parental PIN saved')};$('#logout').onclick=()=>location.reload()}
$('#lockButton').onclick=()=>{const pin=localStorage.getItem('tt-pin');if(!pin)return navigate('settings');state.unlocked=false;$('#pinDialog').showModal()};
$('#pinForm').onsubmit=e=>{e.preventDefault();if(e.submitter?.value==='cancel'){$('#pinDialog').close();return;}if($('#pinInput').value===localStorage.getItem('tt-pin')){state.unlocked=true;$('#pinDialog').close();toast('Parental controls unlocked');render()}else toast('Incorrect PIN')};

window.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;if(document.activeElement?.matches('input,select'))return;const focusables=[...(document.querySelector('dialog[open]')||document).querySelectorAll('button:not([disabled]),input,select,[tabindex="0"]')].filter(x=>x.offsetParent);e.preventDefault();const current=document.activeElement,i=Math.max(0,focusables.indexOf(current));focusables[Math.min(focusables.length-1,i+(e.key==='ArrowRight'||e.key==='ArrowDown'?1:-1))]?.focus()});
if(!window.TopTierNative&&'serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});

async function openSeries(item){
  const previous=state.page;state.page='episodes';$('#pageTitle').textContent=item.name;$('#content').innerHTML='<div class="empty">Loading episodes…</div>';
  try{const data=await getJson(apiUrl('get_series_info',{series_id:item.id}));if(state.page!=='episodes')return;
    const seasons=Object.entries(data.episodes||{}).sort((a,b)=>Number(a[0])-Number(b[0]));
    $('#content').innerHTML='<button id="backSeries" class="primary">← Back to series</button><div id="episodeList"></div>';
    $('#backSeries').onclick=()=>navigate(previous);
    const list=$('#episodeList');if(!seasons.length)list.innerHTML='<div class="empty">No episodes available from this provider.</div>';
    seasons.forEach(([season,episodes])=>{const section=document.createElement('section');section.innerHTML=`<h3>Season ${esc(season)}</h3><div class="grid"></div>`;
      (Array.isArray(episodes)?episodes:[]).forEach(ep=>{const b=document.createElement('button');b.className='card';b.textContent=ep.title||`Episode ${ep.episode_num||''}`;b.onclick=()=>{const p=state.profile;play({id:String(ep.id),name:b.textContent,type:'episode',category:item.category,url:`${p.base}/series/${encodeURIComponent(p.username)}/${encodeURIComponent(p.password)}/${ep.id}.${ep.container_extension||'mp4'}`})};section.querySelector('.grid').append(b)});list.append(section)});
  }catch(e){if(state.page!=='episodes')return;$('#content').innerHTML=`<div class="empty">${esc(e.message)}</div><button class="primary" id="retrySeries">Retry</button><button class="primary" id="backSeries">Back</button>`;$('#retrySeries').onclick=()=>openSeries(item);$('#backSeries').onclick=()=>navigate('series')}
}
window.topTierBack=()=>{if($('#playerDialog').open){$('#closePlayer').click();return true}if($('#pinDialog').open){$('#pinDialog').close();return true}if(state.page==='episodes'){navigate('series');return true}if(!$('#app').hidden&&state.page!=='home'){navigate('home');return true}return false};
