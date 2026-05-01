import { useState, useRef, useCallback } from 'react'
import { MOCK_ITEMS, TAG_DICTIONARY, translateToQueries, rankItems } from './core/searchEngine'
import {
  getCurrentPlan, setPlan, PLANS,
  archiveItem, removeFromArchive, isArchived,
  loadArchive, createFolder, getArchiveStats,
} from './core/archive'

// ─── 상수 ──────────────────────────────────────────────────
const SITE_COLORS = {
  pixiv:'#0096FA', danbooru:'#1A3A5C', twitter:'#1D9BF0',
  gelbooru:'#2E7D32', artstation:'#13AFF0', deviantart:'#05CC47',
  pinterest:'#E60023', zerochan:'#7B5EA7',
}
const CATEGORY_TABS = [
  { key:'all',          label:'All',          emoji:'🎴', color:'#FF6B9D' },
  { key:'official',     label:'Official',     emoji:'✦',  color:'#A855F7' },
  { key:'high_quality', label:'High Quality', emoji:'★',  color:'#F59E0B' },
  { key:'recent',       label:'Recent',       emoji:'⚡', color:'#10B981' },
  { key:'sketch',       label:'Sketch',       emoji:'✏', color:'#6366F1' },
  { key:'cosplay',      label:'Cosplay',      emoji:'🌙', color:'#EC4899' },
]
const FOLDER_EMOJIS = ['🎴','📦','💫','🌸','⭐','🎨','🔥','💜','🎀','🌊']
const DISCLAIMER = '모든 이미지의 저작권은 원작자에게 있으며, 본 서비스는 검색 및 연결 서비스만 제공합니다.'
const fmtLikes = n => n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n)
const ALL_SITES = ['Pixiv','Danbooru','Gelbooru','ArtStation','DeviantArt','Pinterest','Twitter/X','Zerochan']

// ─── Shared style tokens ────────────────────────────────────
const T = {
  labelStyle: { fontSize:10, fontWeight:900, color:'#999', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:4, fontFamily:"'Nunito',sans-serif" },
  inputBase:  { width:'100%', border:'2px solid #eee', borderRadius:10, padding:'8px 12px', fontSize:13, fontWeight:700, outline:'none', fontFamily:"'Nunito Sans',sans-serif", background:'#fafafa', transition:'border .15s, box-shadow .15s', display:'block' },
  card:       { background:'#fff', border:'2.5px solid #1a1a1a', borderRadius:20, boxShadow:'6px 6px 0 #1a1a1a', padding:18 },
  badge:      (bg, col='#fff') => ({ display:'inline-block', padding:'2px 8px', borderRadius:99, fontSize:10, fontWeight:900, color:col, fontFamily:"'Nunito',sans-serif", background:bg }),
  pill:       (color) => ({ display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:99, border:`2px solid ${color}`, background:`${color}18`, color, fontSize:11, fontWeight:900, fontFamily:"'Nunito',sans-serif" }),
  btn:        (bg, col='#1a1a1a', shadow='2px 2px 0 #1a1a1a') => ({ padding:'5px 12px', borderRadius:10, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:11, border:'2px solid #1a1a1a', cursor:'pointer', background:bg, color:col, boxShadow:shadow, transition:'all .12s' }),
  miniBtn:    (bg, col='#fff') => ({ padding:'3px 10px', borderRadius:99, fontSize:10, fontWeight:900, border:'1.5px solid #1a1a1a', cursor:'pointer', fontFamily:"'Nunito',sans-serif", background:bg, color:col }),
}

// ─── TagPill ────────────────────────────────────────────────
function TagPill({ label, onRemove, color = '#FF6B9D' }) {
  return (
    <span style={T.pill(color)}>
      #{label}
      {onRemove && (
        <button onClick={onRemove} style={{ width:14,height:14,borderRadius:99,background:color,color:'#fff',border:'none',cursor:'pointer',fontSize:10,lineHeight:1,display:'flex',alignItems:'center',justifyContent:'center' }}>
          ×
        </button>
      )}
    </span>
  )
}

// ─── PremiumBanner ──────────────────────────────────────────
function PremiumBanner({ plan, onUpgrade }) {
  if (plan.id === 'premium') return null
  return (
    <div style={{ background:'linear-gradient(135deg,#FF6B9D18,#A855F718)', border:'2px solid #FF6B9D', borderRadius:16, padding:'10px 16px', marginBottom:12, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
      <p style={{ fontSize:12, fontWeight:700, color:'#1a1a1a', fontFamily:"'Nunito',sans-serif" }}>
        ✨ <strong>Premium</strong> 업그레이드 — 인기순 정렬 · 무제한 진열장 · 광고 제거
      </p>
      <button onClick={onUpgrade} style={{ padding:'5px 14px', borderRadius:99, background:'linear-gradient(135deg,#FF6B9D,#A855F7)', color:'#fff', border:'2px solid #1a1a1a', boxShadow:'2px 2px 0 #1a1a1a', fontWeight:900, fontSize:12, cursor:'pointer', fontFamily:"'Nunito',sans-serif" }}>
        업그레이드 (데모)
      </button>
    </div>
  )
}

// ─── UploadZone ─────────────────────────────────────────────
function UploadZone({ file, onFile }) {
  const [drag, setDrag] = useState(false)
  const ref = useRef()
  const onDrop = useCallback(e => {
    e.preventDefault(); setDrag(false)
    const f = e.dataTransfer.files?.[0]
    if (f?.type.startsWith('image/')) onFile(f)
  }, [onFile])
  const previewUrl = file ? URL.createObjectURL(file) : null

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      style={{ position:'relative', border:`2px dashed ${drag?'#FF6B9D':'#ddd'}`, borderRadius:14, minHeight:130, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4, cursor:'pointer', overflow:'hidden', background:drag?'#FFF0F5':'#fafafa', boxShadow:drag?'3px 3px 0 #FF6B9D':'none', transition:'all .15s' }}
    >
      {previewUrl ? (
        <>
          <img src={previewUrl} alt="preview" style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover' }} />
          <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,.45)', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <span style={{ color:'#fff', fontWeight:900, fontSize:11, padding:'4px 12px', borderRadius:8, background:'rgba(0,0,0,.5)', border:'2px solid #fff', fontFamily:"'Nunito',sans-serif" }}>변경하기</span>
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize:28 }}>🖼️</div>
          <p style={{ fontSize:12, fontWeight:700, color:'#bbb' }}>드래그 또는 클릭</p>
          <small style={{ fontSize:10, color:'#ddd' }}>JPG · PNG · GIF · WEBP</small>
        </>
      )}
      <input ref={ref} type="file" accept="image/*" style={{ display:'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
    </div>
  )
}

// ─── SearchPanel ────────────────────────────────────────────
function SearchPanel({ onSearch, queries }) {
  const [charName, setCharName] = useState('')
  const [workName, setWorkName] = useState('')
  const [tags, setTags]         = useState([])
  const [tagInput, setTagInput] = useState('')
  const [file, setFile]         = useState(null)
  const [suggest, setSuggest]   = useState([])
  const [showQ, setShowQ]       = useState(false)
  const [loading, setLoading]   = useState(false)

  const DICT_KEYS = Object.keys(TAG_DICTIONARY)

  const addTag = raw => {
    const t = raw.replace(/^#/, '').trim()
    if (t && !tags.includes(t)) setTags(p => [...p, t])
    setTagInput(''); setSuggest([])
  }

  const handleSearch = async () => {
    setLoading(true)
    await new Promise(r => setTimeout(r, 600)) // mock delay
    onSearch({ charName, workName, tags, file })
    setLoading(false)
  }

  return (
    <div style={T.card}>
      {/* 2-col grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
        {/* Upload */}
        <div>
          <div style={T.labelStyle}>🖼️ 이미지 업로드</div>
          <UploadZone file={file} onFile={setFile} />
        </div>
        {/* Text inputs */}
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <div>
            <div style={T.labelStyle}>👤 캐릭터 이름</div>
            <input value={charName} onChange={e=>setCharName(e.target.value)}
              placeholder="예: 하츠네 미쿠, 고죠 사토루…"
              onKeyDown={e=>{ if(e.key==='Enter'&&charName){ addTag(charName); setCharName('') }}}
              style={T.inputBase}
              onFocus={e=>{ e.target.style.border='2px solid #FF6B9D'; e.target.style.boxShadow='3px 3px 0 #FF6B9D' }}
              onBlur={e=>{ e.target.style.border='2px solid #eee'; e.target.style.boxShadow='none' }}
            />
          </div>
          <div>
            <div style={T.labelStyle}>📚 작품명</div>
            <input value={workName} onChange={e=>setWorkName(e.target.value)}
              placeholder="예: 보컬로이드, 원피스…"
              onKeyDown={e=>{ if(e.key==='Enter'&&workName){ addTag(workName); setWorkName('') }}}
              style={T.inputBase}
              onFocus={e=>{ e.target.style.border='2px solid #A855F7'; e.target.style.boxShadow='3px 3px 0 #A855F7' }}
              onBlur={e=>{ e.target.style.border='2px solid #eee'; e.target.style.boxShadow='none' }}
            />
          </div>
          {/* Tag input with autocomplete */}
          <div style={{ position:'relative' }}>
            <div style={T.labelStyle}>🏷️ 태그 추가</div>
            <input value={tagInput}
              onChange={e=>{ setTagInput(e.target.value); const q=e.target.value.toLowerCase(); setSuggest(q ? DICT_KEYS.filter(k=>k.includes(e.target.value)||TAG_DICTIONARY[k].danbooru.includes(q)).slice(0,5) : []) }}
              onKeyDown={e=>{ if((e.key==='Enter'||e.key===',')&&tagInput.trim()){e.preventDefault();addTag(tagInput)} if(e.key==='Backspace'&&!tagInput&&tags.length) setTags(p=>p.slice(0,-1)) }}
              placeholder="태그 입력 후 Enter…"
              style={T.inputBase}
              onFocus={e=>{ e.target.style.border='2px solid #10B981'; e.target.style.boxShadow='3px 3px 0 #10B981' }}
              onBlur={e=>{ setTimeout(()=>setSuggest([]),160); e.target.style.border='2px solid #eee'; e.target.style.boxShadow='none' }}
            />
            {suggest.length > 0 && (
              <div style={{ position:'absolute', top:'calc(100% + 4px)', left:0, right:0, background:'#fff', border:'2px solid #1a1a1a', borderRadius:12, boxShadow:'4px 4px 0 #1a1a1a', zIndex:20, overflow:'hidden' }}>
                {suggest.map(s => (
                  <button key={s} onMouseDown={()=>addTag(s)}
                    style={{ width:'100%', textAlign:'left', padding:'7px 12px', background:'none', border:'none', borderBottom:'1px solid #f5f5f5', cursor:'pointer', fontFamily:"'Nunito',sans-serif", fontWeight:700, fontSize:12, display:'flex', flexDirection:'column', gap:1 }}>
                    <span>{s}</span>
                    <span style={{ fontSize:10, color:'#aaa', fontFamily:'monospace' }}>→ {TAG_DICTIONARY[s]?.danbooru} · {TAG_DICTIONARY[s]?.ja}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tag pills */}
      {tags.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:5, padding:'8px 10px', marginBottom:12, background:'#FFF8FC', border:'1.5px dashed #FFB3D1', borderRadius:10 }}>
          {tags.map(t => <TagPill key={t} label={t} onRemove={()=>setTags(p=>p.filter(x=>x!==t))} />)}
          <button onClick={()=>setTags([])} style={{ fontSize:10, color:'#ccc', background:'none', border:'none', cursor:'pointer', fontFamily:"'Nunito',sans-serif", fontWeight:700 }}>전체 삭제</button>
        </div>
      )}

      {/* Query preview */}
      {queries && Object.keys(queries).length > 0 && (
        <div style={{ marginBottom:12 }}>
          <button onClick={()=>setShowQ(v=>!v)} style={{ fontSize:11, fontWeight:700, color:'#A855F7', background:'none', border:'none', cursor:'pointer', fontFamily:"'Nunito',sans-serif" }}>
            {showQ?'▲':'▼'} 생성된 검색 쿼리 ({Object.keys(queries).length}개 사이트)
          </button>
          {showQ && (
            <div style={{ marginTop:6, padding:'8px 10px', background:'#F8F0FF', border:'1.5px solid #E9D5FF', borderRadius:10, display:'flex', flexDirection:'column', gap:4 }}>
              {Object.entries(queries).map(([site, url]) => (
                <div key={site} style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ padding:'1px 7px', borderRadius:99, background:SITE_COLORS[site]??'#888', color:'#fff', fontSize:9, fontWeight:900, minWidth:72, textAlign:'center', fontFamily:"'Nunito',sans-serif" }}>{site}</span>
                  <a href={url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize:10, color:'#7C3AED', fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:380 }}>{url}</a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Search button */}
      <button onClick={handleSearch} disabled={loading}
        style={{ width:'100%', padding:11, borderRadius:12, fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:13, letterSpacing:'.03em', background: loading ? '#ddd' : 'linear-gradient(135deg,#FF6B9D 0%,#C44BE0 100%)', color: loading?'#aaa':'#fff', border:'2.5px solid #1a1a1a', boxShadow:'4px 4px 0 #1a1a1a', cursor: loading?'not-allowed':'pointer', transition:'all .1s' }}
        onMouseEnter={e=>{ if(!loading){e.currentTarget.style.transform='translate(-1px,-1px)';e.currentTarget.style.boxShadow='5px 5px 0 #1a1a1a'} }}
        onMouseLeave={e=>{ e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='4px 4px 0 #1a1a1a' }}
        onMouseDown={e=>{ if(!loading){e.currentTarget.style.transform='translate(2px,2px)';e.currentTarget.style.boxShadow='1px 1px 0 #1a1a1a'} }}
        onMouseUp={e=>{ e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='4px 4px 0 #1a1a1a' }}
      >
        {loading ? '⏳ 서칭 중...' : '🔍 팬아트 서칭 START!'}
      </button>
    </div>
  )
}

// ─── ArtCard ────────────────────────────────────────────────
function ArtCard({ item, onArchiveChange }) {
  const [hovered, setHovered]     = useState(false)
  const [saved, setSaved]         = useState(() => isArchived(item.id))
  const [feedback, setFeedback]   = useState(null)

  const handleArchive = e => {
    e.stopPropagation()
    if (saved) {
      removeFromArchive(item.id)
      setSaved(false)
      onArchiveChange?.()
      return
    }
    const r = archiveItem(item)
    if (r.success)                   { setSaved(true); setFeedback('saved'); onArchiveChange?.() }
    else if (r.reason==='limit_reached') setFeedback('limit')
    else if (r.reason==='already_saved') setFeedback('already')
    setTimeout(()=>setFeedback(null), 2200)
  }

  const openSite = e => {
    e.stopPropagation()
    // open direct search link for this card's site
    const q = encodeURIComponent(item.tags[0] ?? item.title)
    const urls = {
      pixiv:      `https://www.pixiv.net/search.php?word=${q}&s_mode=s_tag`,
      danbooru:   `https://danbooru.donmai.us/posts?tags=${q}`,
      twitter:    `https://twitter.com/search?q=${q}+fanart&f=image`,
      artstation: `https://www.artstation.com/search?query=${q}`,
      deviantart: `https://www.deviantart.com/search?q=${q}`,
      gelbooru:   `https://gelbooru.com/index.php?page=post&s=list&tags=${q}`,
    }
    window.open(urls[item.site] ?? `https://www.pixiv.net/search.php?word=${q}`, '_blank', 'noopener')
  }

  return (
    <div
      onMouseEnter={()=>setHovered(true)}
      onMouseLeave={()=>setHovered(false)}
      style={{ borderRadius:14, overflow:'hidden', cursor:'pointer', border:'2.5px solid #1a1a1a', boxShadow:hovered?'6px 6px 0 #1a1a1a':'4px 4px 0 #1a1a1a', transform:hovered?'translate(-2px,-2px) scale(1.025)':'none', transition:'transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .18s ease', background:'#fff', position:'relative' }}
    >
      <div style={{ position:'relative', aspectRatio:'3/4', overflow:'hidden' }}>
        <img src={item.src} alt={item.title} loading="lazy"
          style={{ width:'100%', height:'100%', objectFit:'cover', transform:hovered?'scale(1.06)':'scale(1)', transition:'transform .3s ease' }} />

        {/* Category badge */}
        <span style={{ position:'absolute', top:6, left:6, padding:'2px 8px', borderRadius:99, background:item.badgeColor, color:'#fff', fontSize:10, fontWeight:900, border:'2px solid #fff', fontFamily:"'Nunito',sans-serif" }}>{item.badge}</span>

        {/* Site badge */}
        <span style={{ position:'absolute', top:6, right:6, padding:'2px 7px', borderRadius:99, background:SITE_COLORS[item.site]??'#888', color:'#fff', fontSize:9, fontWeight:900, border:'2px solid #fff', fontFamily:"'Nunito',sans-serif" }}>{item.site}</span>

        {/* Hover overlay */}
        <div style={{ position:'absolute', inset:0, background:'linear-gradient(to top,rgba(0,0,0,.75) 0%,transparent 55%)', opacity:hovered?1:0, transition:'opacity .2s', display:'flex', flexDirection:'column', justifyContent:'flex-end', padding:8, gap:5 }}>
          <div style={{ display:'flex', gap:5 }}>
            <button onClick={handleArchive} style={{ flex:1, padding:'4px 0', borderRadius:99, background:saved?'#FF6B9D':'rgba(255,255,255,.92)', color:saved?'#fff':'#1a1a1a', border:'2px solid #fff', fontWeight:900, fontSize:10, cursor:'pointer', fontFamily:"'Nunito',sans-serif" }}>
              {saved?'💾 저장됨':'💾 저장'}
            </button>
            <button onClick={openSite} style={{ flex:1, padding:'4px 0', borderRadius:99, background:'rgba(255,255,255,.92)', color:'#1a1a1a', border:'2px solid #fff', fontWeight:900, fontSize:10, cursor:'pointer', fontFamily:"'Nunito',sans-serif" }}>
              🔗 원본
            </button>
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:3 }}>
            {item.tags.slice(0,3).map(t => (
              <span key={t} style={{ padding:'1px 6px', borderRadius:99, background:'rgba(255,255,255,.2)', color:'#fff', fontSize:9, fontWeight:700, backdropFilter:'blur(4px)' }}>#{t}</span>
            ))}
          </div>
          <p style={{ fontSize:8, color:'rgba(255,255,255,.55)', lineHeight:1.3, margin:0 }}>{DISCLAIMER}</p>
        </div>

        {/* Feedback overlay */}
        {feedback && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.6)', backdropFilter:'blur(4px)' }}>
            <div style={{ padding:'8px 14px', borderRadius:12, background:'#fff', fontWeight:900, fontSize:11, fontFamily:"'Nunito',sans-serif", border:'2px solid #1a1a1a', textAlign:'center', lineHeight:1.5 }}>
              {feedback==='saved'  && '✅ 진열장에 저장됐어요!'}
              {feedback==='limit'  && '🔒 무료 2개 한도 초과\nPremium으로 업그레이드하세요'}
              {feedback==='already'&& '이미 저장된 작품이에요'}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding:'8px 10px', background:'#fff' }}>
        <p style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:12, color:'#1a1a1a', margin:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.title}</p>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:2 }}>
          <span style={{ fontSize:10, color:'#aaa', fontWeight:600 }}>{item.artist}</span>
          <div style={{ display:'flex', gap:5, alignItems:'center' }}>
            <span style={{ fontSize:10, fontWeight:900, color:'#FF6B9D' }}>♥ {fmtLikes(item.likes)}</span>
            {item._score != null && (
              <span style={{ fontSize:9, padding:'1px 5px', borderRadius:99, background:'#FEF08A', border:'1px solid #1a1a1a', fontWeight:900, color:'#1a1a1a' }}>
                {(item._score*100).toFixed(0)}pt
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── ArchiveDrawer ──────────────────────────────────────────
function ArchiveDrawer({ open, onClose, plan, onPlanChange }) {
  const [archive, setArchive]       = useState(loadArchive)
  const [activeFolder, setFolder]   = useState('default')
  const [newName, setNewName]       = useState('')
  const [selEmoji, setSelEmoji]     = useState('📦')

  const refresh = () => setArchive(loadArchive())
  const stats   = getArchiveStats()
  const folder  = archive.folders.find(f=>f.id===activeFolder) ?? archive.folders[0]

  const handleCreate = () => {
    if (!newName.trim()) return
    const r = createFolder(newName.trim(), selEmoji)
    if (r.success) { setNewName(''); refresh() }
    else alert('폴더 생성은 Premium 전용입니다.')
  }

  if (!open) return null

  return (
    <div style={{ position:'fixed', inset:0, zIndex:50, display:'flex', justifyContent:'flex-end' }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()}
        style={{ width:320, maxWidth:'90vw', height:'100dvh', background:'#FFF0F8', border:'2.5px solid #1a1a1a', boxShadow:'-6px 0 0 #1a1a1a', display:'flex', flexDirection:'column', animation:'slideInRight .25s ease' }}>

        {/* Header */}
        <div style={{ padding:'14px 16px', borderBottom:'2px solid #FFD6E8', background:'#fff', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
          <div>
            <h2 style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:16, margin:0 }}>🎴 나의 굿즈 진열장</h2>
            <p style={{ fontSize:10, color:'#aaa', margin:0, fontWeight:600 }}>
              {stats.isPremium ? '무제한' : `${stats.total}/${stats.limit}`}개 저장 · {stats.isPremium?'Premium ✨':'Free'}
            </p>
          </div>
          <button onClick={onClose} style={{ width:28, height:28, borderRadius:99, background:'#f0f0f0', border:'1.5px solid #ddd', cursor:'pointer', fontSize:18, fontWeight:900, color:'#888', lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
        </div>

        {/* Plan switcher (demo) */}
        <div style={{ padding:'8px 14px', background:'#FFF8FC', borderBottom:'1.5px dashed #FFD6E8', display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <span style={{ fontSize:11, fontWeight:700, color:'#888' }}>구독 플랜:</span>
          <button onClick={()=>{ setPlan('free'); onPlanChange(PLANS.FREE) }} style={T.miniBtn(plan.id==='free'?'#9CA3AF':'#f0f0f0', plan.id==='free'?'#fff':'#888')}>Free</button>
          <button onClick={()=>{ setPlan('premium'); onPlanChange(PLANS.PREMIUM) }} style={T.miniBtn(plan.id==='premium'?'#FF6B9D':'#f0f0f0', plan.id==='premium'?'#fff':'#888')}>✨ Premium</button>
        </div>

        {/* Folder tabs */}
        <div style={{ padding:'8px 14px', borderBottom:'1.5px dashed #FFD6E8', display:'flex', gap:5, overflowX:'auto', flexShrink:0 }}>
          {archive.folders.map(f => (
            <button key={f.id} onClick={()=>setFolder(f.id)}
              style={{ padding:'4px 10px', borderRadius:8, fontSize:11, fontWeight:900, border:'2px solid #1a1a1a', cursor:'pointer', fontFamily:"'Nunito',sans-serif", whiteSpace:'nowrap', background:activeFolder===f.id?'#FF6B9D':'#fff', color:activeFolder===f.id?'#fff':'#1a1a1a', boxShadow:activeFolder===f.id?'2px 2px 0 #1a1a1a':'1px 1px 0 #ccc' }}>
              {f.emoji} {f.name}
              {f.items.length > 0 && <span style={{ marginLeft:3, fontSize:9, background:'rgba(0,0,0,.15)', borderRadius:99, padding:'0 4px' }}>{f.items.length}</span>}
            </button>
          ))}
        </div>

        {/* New folder (premium) */}
        {plan.id === 'premium' && (
          <div style={{ padding:'8px 14px', borderBottom:'1.5px dashed #FFD6E8', display:'flex', gap:5, alignItems:'center', flexShrink:0 }}>
            <select value={selEmoji} onChange={e=>setSelEmoji(e.target.value)} style={{ border:'2px solid #eee', borderRadius:8, padding:'4px 6px', fontSize:14 }}>
              {FOLDER_EMOJIS.map(e=><option key={e} value={e}>{e}</option>)}
            </select>
            <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="새 진열장 이름…"
              onKeyDown={e=>e.key==='Enter'&&handleCreate()}
              style={{ ...T.inputBase, flex:1, fontSize:12, margin:0 }} />
            <button onClick={handleCreate} style={T.miniBtn('#A855F7')}>+ 추가</button>
          </div>
        )}

        {/* Items */}
        <div style={{ flex:1, overflowY:'auto', padding:'10px 14px', display:'flex', flexDirection:'column', gap:8 }}>
          {!folder || folder.items.length === 0 ? (
            <div style={{ textAlign:'center', paddingTop:40, color:'#ccc' }}>
              <div style={{ fontSize:36, marginBottom:8 }}>📭</div>
              <p style={{ fontSize:12, fontWeight:700 }}>아직 저장된 작품이 없어요</p>
              <p style={{ fontSize:11, color:'#ddd' }}>카드의 💾 버튼을 눌러 저장하세요</p>
            </div>
          ) : (
            folder.items.map(item => (
              <div key={item.id} style={{ display:'flex', gap:8, alignItems:'center', background:'#fff', borderRadius:12, border:'2px solid #eee', padding:'8px 10px' }}>
                <img src={item.src} alt={item.title} style={{ width:44, height:54, objectFit:'cover', borderRadius:8, border:'2px solid #1a1a1a', flexShrink:0 }} />
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:11, margin:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.title}</p>
                  <p style={{ fontSize:10, color:'#aaa', margin:0 }}>{item.artist}</p>
                  <p style={{ fontSize:9, color:'#ccc', margin:0 }}>{new Date(item.savedAt).toLocaleDateString('ko-KR')}</p>
                </div>
                <button onClick={()=>{ removeFromArchive(item.id); refresh() }} style={{ width:24, height:24, borderRadius:99, background:'#f0f0f0', border:'1.5px solid #ddd', cursor:'pointer', fontSize:16, fontWeight:900, color:'#888', lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>×</button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'8px 14px', borderTop:'1.5px dashed #FFD6E8', background:'#fff8fc', flexShrink:0 }}>
          <p style={{ fontSize:9, color:'#ccc', margin:0, lineHeight:1.5 }}>{DISCLAIMER}</p>
        </div>
      </div>
    </div>
  )
}

// ─── App Root ───────────────────────────────────────────────
export default function App() {
  const [plan, setPlanState]       = useState(getCurrentPlan)
  const [activeCat, setActiveCat]  = useState('all')
  const [sortMode, setSortMode]    = useState('recent')
  const [results, setResults]      = useState(MOCK_ITEMS)
  const [queries, setQueries]      = useState({})
  const [drawerOpen, setDrawer]    = useState(false)
  const [archiveTick, setTick]     = useState(0) // force re-render after archive change

  const handlePlanChange = newPlan => {
    setPlanState(newPlan)
    if (newPlan.id === 'free' && sortMode === 'popularity') setSortMode('recent')
  }

  const handleSearch = ({ charName, workName, tags }) => {
    const allInput = [charName, workName].join(' ').trim()
    setQueries(translateToQueries(allInput, tags))

    const terms = [charName, workName, ...tags].map(s=>s.toLowerCase().replace(/\s+/g,'_')).filter(Boolean)
    const filtered = terms.length === 0 ? MOCK_ITEMS
      : MOCK_ITEMS.filter(item => terms.some(q => item.tags.some(t=>t.includes(q)) || item.title.toLowerCase().includes(q.replace(/_/g,' '))))

    setResults(filtered.length ? filtered : MOCK_ITEMS)
    setActiveCat('all')
  }

  const displayItems = (() => {
    const base = activeCat === 'all' ? results : results.filter(i=>i.category===activeCat)
    return rankItems(base, sortMode)
  })()

  const stats = getArchiveStats()

  return (
    <div style={{ maxWidth:800, margin:'0 auto', padding:'16px 14px 32px' }}>

      {/* ── Header ── */}
      <header style={{ textAlign:'center', marginBottom:18 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:6 }}>
          <span style={{ fontSize:30, animation:'logoBounce 2.5s ease-in-out infinite', display:'inline-block' }}>🎴</span>
          <h1 style={{ fontFamily:"'Nunito',sans-serif", fontWeight:900, fontSize:34, background:'linear-gradient(135deg,#FF6B9D 0%,#A855F7 50%,#6366F1 100%)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', letterSpacing:'-0.02em' }}>MemeBox</h1>
          <span style={T.badge('#FEF08A','#1a1a1a')}>v2.0</span>
        </div>
        <div style={{ display:'flex', justifyContent:'center', gap:4, flexWrap:'wrap', marginBottom:6 }}>
          {ALL_SITES.map(s => {
            const key = s.toLowerCase().replace('/x','').replace('twitter','twitter').trim()
            const col = Object.entries(SITE_COLORS).find(([k])=>key.includes(k))?.[1] ?? '#888'
            return <span key={s} style={T.badge(col)}>{s}</span>
          })}
        </div>
        <p style={{ fontSize:11, color:'#bbb', fontWeight:600, marginBottom:8 }}>
          이미지 + 이름으로 전 세계 팬아트를 한눈에 — 한국어 자동 다국어 변환 🌍
        </p>
        <button onClick={()=>setDrawer(true)} style={{ padding:'6px 14px', borderRadius:99, background:'#fff', border:'2px solid #FF6B9D', color:'#FF6B9D', fontWeight:900, fontSize:12, cursor:'pointer', fontFamily:"'Nunito',sans-serif", boxShadow:'2px 2px 0 #FF6B9D' }}>
          💾 나의 진열장 ({stats.total}{stats.isPremium?'':'/' +stats.limit})
        </button>
      </header>

      {/* ── Premium Banner ── */}
      <PremiumBanner plan={plan} onUpgrade={()=>{ setPlan('premium'); handlePlanChange(PLANS.PREMIUM) }} />

      {/* ── Search ── */}
      <div style={{ marginBottom:14 }}>
        <SearchPanel onSearch={handleSearch} queries={queries} />
      </div>

      {/* ── Category Tabs ── */}
      <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:10 }}>
        {CATEGORY_TABS.map(tab => {
          const active = activeCat === tab.key
          return (
            <button key={tab.key} onClick={()=>setActiveCat(tab.key)}
              style={{ ...T.btn(active?tab.color:'#fff', active?'#fff':'#1a1a1a', active?'3px 3px 0 #1a1a1a':'2px 2px 0 #1a1a1a'), transform:active?'translate(-1px,-1px)':'none' }}>
              {tab.emoji} {tab.label}
            </button>
          )
        })}
      </div>

      {/* ── Sort + Stats ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12, flexWrap:'wrap', gap:6 }}>
        <div style={{ display:'flex', gap:5, alignItems:'center' }}>
          <span style={{ padding:'3px 10px', borderRadius:99, fontSize:10, fontWeight:900, background:'#fff', border:'2px solid #eee', boxShadow:'2px 2px 0 #eee', color:'#888', fontFamily:"'Nunito',sans-serif" }}>총 {displayItems.length}개</span>
          {/* 최신순 - 무료 가능 */}
          <button onClick={()=>setSortMode('recent')} style={{ ...T.btn(sortMode==='recent'?'#FEF08A':'#fff','#1a1a1a',sortMode==='recent'?'2px 2px 0 #1a1a1a':'1px 1px 0 #ccc') }}>⚡ 최신순</button>
          {/* 인기순 - Premium 전용 */}
          <div style={{ position:'relative' }}>
            <button onClick={()=>{ if(plan.id!=='premium'){alert('인기순 정렬은 Premium 전용입니다 ✨');return} setSortMode('popularity') }}
              style={{ ...T.btn(sortMode==='popularity'?'#FF6B9D':'#f5f5f5', sortMode==='popularity'?'#fff':plan.id==='premium'?'#1a1a1a':'#bbb', sortMode==='popularity'?'2px 2px 0 #1a1a1a':'1px 1px 0 #ccc') }}>
              ♥ 인기순
            </button>
            {plan.id !== 'premium' && (
              <span style={{ position:'absolute', top:-7, right:-7, fontSize:9, background:'#FF6B9D', color:'#fff', borderRadius:99, padding:'1px 4px', fontWeight:900, fontFamily:"'Nunito',sans-serif", pointerEvents:'none' }}>PRO</span>
            )}
          </div>
        </div>
        <span style={{ fontSize:10, color:'#ddd', fontWeight:600 }}>Mock data · API 연결 준비됨</span>
      </div>

      {/* ── Gallery ── */}
      <div className="masonry">
        {displayItems.map((item, i) => (
          <div key={item.id} className="masonry-item" style={{ animationDelay:`${i*35}ms` }}>
            <ArtCard item={item} onArchiveChange={()=>setTick(t=>t+1)} />
          </div>
        ))}
      </div>

      {/* ── Footer ── */}
      <footer style={{ marginTop:28, paddingTop:14, borderTop:'2px dashed #FFD6E8', textAlign:'center' }}>
        <p style={{ fontSize:10, color:'#bbb', fontWeight:600, lineHeight:1.6, maxWidth:480, margin:'0 auto 6px' }}>{DISCLAIMER}</p>
        <p style={{ fontSize:9, color:'#ddd', fontWeight:600 }}>
          MemeBox는 팬아트를 <strong>생성</strong>하지 않습니다 — 오직 <strong>서칭</strong>하고 <strong>큐레이션</strong>합니다 🎴
        </p>
        <div style={{ display:'flex', justifyContent:'center', gap:4, flexWrap:'wrap', marginTop:6 }}>
          {Object.entries(SITE_COLORS).map(([site,color]) => (
            <span key={site} style={T.badge(color)}>{site}</span>
          ))}
        </div>
      </footer>

      {/* ── Archive Drawer ── */}
      <ArchiveDrawer open={drawerOpen} onClose={()=>setDrawer(false)} plan={plan} onPlanChange={handlePlanChange} />
    </div>
  )
}
