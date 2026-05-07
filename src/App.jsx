import { useState, useRef, useCallback } from 'react'
import { TAG_DICTIONARY } from './core/searchEngine'
import {
  getCurrentPlan, setPlan, PLANS,
  archiveItem, removeFromArchive, isArchived,
  loadArchive, createFolder, getArchiveStats,
} from './core/archive'

// ══════════════════════════════════════════════════════════════
//  API 레이어
//  ─ Safebooru : 전체이용가 전용, CORS 완전 허용, API 키 불필요
//  ─ Gelbooru  : CORS 허용, 백업용
// ══════════════════════════════════════════════════════════════

/** 한국어 → Danbooru/Gelbooru 태그 변환 */
function toTag(input) {
  const entry = TAG_DICTIONARY[input] ?? TAG_DICTIONARY[input.toLowerCase()]
  if (entry) return entry.danbooru
  return input.toLowerCase().trim().replace(/\s+/g, '_')
}

/**
 * Safebooru API
 * - CORS 완전 허용 (Access-Control-Allow-Origin: *)
 * - 전체이용가(rating:general) 만 제공
 * - 문서: https://safebooru.org/index.php?page=help&topic=dapi
 */
async function searchSafebooru(tag, page = 1, limit = 40) {
  // pid = page index (0부터 시작)
  const pid = page - 1
  const url =
    `https://safebooru.org/index.php?page=dapi&s=post&q=index` +
    `&json=1&limit=${limit}&pid=${pid}` +
    `&tags=${encodeURIComponent(tag)}`

  const res  = await fetch(url)
  if (!res.ok) throw new Error(`Safebooru ${res.status}`)
  const data = await res.json()

  // Safebooru JSON: 배열 또는 { post: [...] } 두 형태 모두 올 수 있음
  const posts = Array.isArray(data) ? data : (data?.post ?? [])

  return posts
    .filter(p => p.preview_url || p.sample_url)
    .map(p => ({
      id:    `sb_${p.id}`,
      rawId: p.id,
      title: (p.tags ?? '').split(' ')
               .filter(t => !t.startsWith('rating:'))
               .slice(0, 4)
               .map(t => t.replace(/_/g, ' '))
               .join(', ') || tag.replace(/_/g, ' '),
      artist: extractArtist(p.tags ?? ''),
      thumb:  p.preview_url  ?? p.sample_url,
      large:  p.sample_url   ?? p.preview_url,
      src:    p.preview_url  ?? p.sample_url,
      likes:  p.score        ?? 0,
      favs:   0,
      date:   p.created_at   ?? '',
      tags:   (p.tags ?? '').split(' ').filter(Boolean).slice(0, 12),
      site:   'safebooru',
      url:    `https://safebooru.org/index.php?page=post&s=view&id=${p.id}`,
      width:  p.width,
      height: p.height,
    }))
}

/** tags 문자열에서 artist: 접두어 태그 추출 */
function extractArtist(tags) {
  // Safebooru는 artist 분리 필드 없음 → 단순 표시
  return 'unknown'
}

/**
 * Gelbooru API (백업)
 * - CORS 허용
 * - 성인 콘텐츠 포함 → rating:general 필터 필수
 */
async function searchGelbooru(tag, page = 1, limit = 40) {
  const pid = page - 1
  const safetag = tag + '+rating:general'
  const url =
    `https://gelbooru.com/index.php?page=dapi&s=post&q=index` +
    `&json=1&limit=${limit}&pid=${pid}` +
    `&tags=${encodeURIComponent(safetag)}`

  const res  = await fetch(url)
  if (!res.ok) throw new Error(`Gelbooru ${res.status}`)
  const data = await res.json()
  const posts = Array.isArray(data) ? data : (data?.post ?? [])

  return posts
    .filter(p => p.preview_url || p.sample_url)
    .map(p => ({
      id:    `gb_${p.id}`,
      rawId: p.id,
      title: (p.tags ?? '').split(' ')
               .filter(t => !t.startsWith('rating:'))
               .slice(0, 4)
               .map(t => t.replace(/_/g, ' '))
               .join(', ') || tag.replace(/_/g, ' '),
      artist: 'unknown',
      thumb:  p.preview_url ?? p.sample_url,
      large:  p.sample_url  ?? p.preview_url,
      src:    p.preview_url ?? p.sample_url,
      likes:  p.score       ?? 0,
      favs:   0,
      date:   p.created_at  ?? '',
      tags:   (p.tags ?? '').split(' ').filter(Boolean).slice(0, 12),
      site:   'gelbooru',
      url:    `https://gelbooru.com/index.php?page=post&s=view&id=${p.id}`,
      width:  p.width,
      height: p.height,
    }))
}

/** Safebooru 먼저 시도 → 실패 시 Gelbooru 폴백 */
async function searchImages(query, page, sort) {
  const tag = toTag(query)

  // 정렬 태그 추가
  const sortTag = sort === 'score' ? 'sort:score:desc'
                : sort === 'new'   ? 'sort:id:desc'
                : ''
  const finalTag = [tag, sortTag].filter(Boolean).join('+')

  try {
    const results = await searchSafebooru(finalTag, page)
    if (results.length > 0) return { results, source: 'Safebooru' }
  } catch (e) {
    console.warn('Safebooru failed, trying Gelbooru…', e)
  }

  // Gelbooru 폴백
  const results = await searchGelbooru(finalTag, page)
  return { results, source: 'Gelbooru' }
}

// ══════════════════════════════════════════════════════════════
//  상수
// ══════════════════════════════════════════════════════════════
const DISCLAIMER =
  '모든 이미지의 저작권은 원작자에게 있으며, 본 서비스는 검색 및 연결 서비스만 제공합니다.'

const QUICK_TAGS = [
  '하츠네 미쿠', '고죠 사토루', '루피', '나루토', '탄지로', '에렌',
  '호시노 아이', '블루아카',  '링크', '보컬로이드', '귀멸',  '원피스',
]

const SORT_TABS = [
  { key: 'all',   label: '전체',      color: '#FF6B9D' },
  { key: 'score', label: '인기순 ♥',  color: '#F59E0B' },
  { key: 'new',   label: '최신순 ⚡', color: '#10B981' },
]

// ══════════════════════════════════════════════════════════════
//  공통 스타일 토큰
// ══════════════════════════════════════════════════════════════
const S = {
  card: {
    borderRadius: 12, overflow: 'hidden', cursor: 'pointer',
    border: '2px solid #1a1a1a', boxShadow: '3px 3px 0 #1a1a1a',
    transition: 'transform .15s, box-shadow .15s', position: 'relative',
    background: '#efefef',
  },
  pill: (color) => ({
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '2px 9px', borderRadius: 99, fontSize: 10, fontWeight: 900,
    border: `1.5px solid ${color}`, background: `${color}18`, color,
    fontFamily: "'Nunito',sans-serif",
  }),
  btn: (bg, col = '#fff') => ({
    padding: '9px 0', borderRadius: 12, fontWeight: 900, fontSize: 12,
    border: '2px solid #1a1a1a', cursor: 'pointer', fontFamily: "'Nunito',sans-serif",
    background: bg, color: col, transition: 'opacity .15s',
  }),
}

// ══════════════════════════════════════════════════════════════
//  ImageCard
// ══════════════════════════════════════════════════════════════
function ImageCard({ item, onClick }) {
  const [loaded,  setLoaded]  = useState(false)
  const [errored, setErrored] = useState(false)

  const ratio = item.width && item.height
    ? Math.min(Math.max(item.height / item.width, 0.75), 1.6)
    : 1

  return (
    <div
      style={S.card}
      onClick={() => onClick(item)}
      onMouseEnter={e => {
        e.currentTarget.style.transform  = 'translate(-2px,-2px) scale(1.03)'
        e.currentTarget.style.boxShadow  = '5px 5px 0 #1a1a1a'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform  = 'none'
        e.currentTarget.style.boxShadow  = '3px 3px 0 #1a1a1a'
      }}
    >
      {/* 스켈레톤 */}
      {!loaded && (
        <div style={{ paddingTop: `${ratio * 100}%`, background: '#e8e8e8', animation: 'shimmer 1.4s ease infinite' }} />
      )}

      <img
        src={item.thumb}
        alt={item.title}
        loading="lazy"
        style={{ width: '100%', display: loaded && !errored ? 'block' : 'none', objectFit: 'cover' }}
        onLoad={() => setLoaded(true)}
        onError={() => { setErrored(true); setLoaded(true) }}
      />

      {errored && (
        <div style={{ paddingTop: '100%', position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, background: '#f5f5f5' }}>🖼️</div>
        </div>
      )}

      {/* 점수 배지 */}
      {item.likes > 0 && (
        <span style={{ position: 'absolute', bottom: 5, right: 5, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6, backdropFilter: 'blur(4px)' }}>
          ♥ {item.likes}
        </span>
      )}

      {/* 사이트 배지 */}
      <span style={{ position: 'absolute', top: 5, left: 5, background: item.site === 'gelbooru' ? '#2E7D32' : '#1565C0', color: '#fff', fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 4, opacity: 0.85 }}>
        {item.site}
      </span>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  LightBox
// ══════════════════════════════════════════════════════════════
function LightBox({ item, onClose, onArchiveChange }) {
  const [saved,    setSaved]    = useState(() => isArchived(item.id))
  const [imgError, setImgError] = useState(false)

  const handleSave = () => {
    if (saved) {
      removeFromArchive(item.id)
      setSaved(false)
      onArchiveChange?.()
      return
    }
    const r = archiveItem(item)
    if (r.success)                      { setSaved(true); onArchiveChange?.() }
    else if (r.reason === 'limit_reached') alert('무료 플랜은 2개까지만 저장할 수 있어요!\n진열장에서 Premium으로 업그레이드하세요 ✨')
    else if (r.reason === 'already_saved') alert('이미 저장된 작품이에요!')
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 20, border: '2.5px solid #1a1a1a', boxShadow: '8px 8px 0 #1a1a1a', maxWidth: 620, width: '100%', maxHeight: '92dvh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
      >
        {/* 이미지 */}
        <div style={{ background: '#111', borderRadius: '18px 18px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 180, maxHeight: 460, overflow: 'hidden' }}>
          <img
            src={imgError ? item.thumb : item.large}
            alt={item.title}
            style={{ maxWidth: '100%', maxHeight: 460, objectFit: 'contain', display: 'block' }}
            onError={() => setImgError(true)}
          />
        </div>

        {/* 정보 */}
        <div style={{ padding: '16px 18px', fontFamily: "'Nunito',sans-serif" }}>

          {/* 제목 + 점수 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
            <p style={{ fontWeight: 900, fontSize: 14, color: '#1a1a1a', margin: 0, lineHeight: 1.4 }}>{item.title}</p>
            <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
              <span style={S.pill('#FF6B9D')}>♥ {item.likes}</span>
            </div>
          </div>

          {/* 태그 목록 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 14 }}>
            {item.tags.slice(0, 16).map(t => (
              <span key={t} style={{ padding: '2px 7px', borderRadius: 99, background: '#f5f5f5', border: '1px solid #e0e0e0', fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
                #{t}
              </span>
            ))}
          </div>

          {/* 버튼 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <a
              href={item.url} target="_blank" rel="noopener noreferrer"
              style={{ ...S.btn(item.site === 'gelbooru' ? '#2E7D32' : '#1565C0'), flex: 1, textAlign: 'center', textDecoration: 'none', display: 'block', boxShadow: '2px 2px 0 #1a1a1a' }}
            >
              🔗 원본 보기
            </a>
            <button
              onClick={handleSave}
              style={{ ...S.btn(saved ? '#FF6B9D' : '#fff', saved ? '#fff' : '#FF6B9D'), flex: 1, border: '2px solid #FF6B9D', boxShadow: '2px 2px 0 #FF6B9D' }}
            >
              {saved ? '💾 저장됨' : '💾 진열장에 저장'}
            </button>
            <button
              onClick={onClose}
              style={{ padding: '9px 14px', borderRadius: 12, background: '#f5f5f5', color: '#888', border: '2px solid #ddd', fontWeight: 900, fontSize: 16, cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>

          <p style={{ fontSize: 9, color: '#ccc', marginTop: 10, lineHeight: 1.5 }}>{DISCLAIMER}</p>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  SearchBar
// ══════════════════════════════════════════════════════════════
function SearchBar({ onSearch, loading }) {
  const [value,   setValue]   = useState('')
  const [suggest, setSuggest] = useState([])
  const [open,    setOpen]    = useState(false)
  const inputRef              = useRef()
  const DICT_KEYS             = Object.keys(TAG_DICTIONARY)

  const handleChange = v => {
    setValue(v)
    if (!v.trim()) { setSuggest([]); setOpen(false); return }
    const q  = v.toLowerCase()
    const sg = DICT_KEYS
      .filter(k => k.toLowerCase().includes(q) || TAG_DICTIONARY[k]?.danbooru?.includes(q.replace(/\s/g,'_')))
      .slice(0, 8)
    setSuggest(sg)
    setOpen(sg.length > 0)
  }

  const submit = q => {
    const clean = q.trim()
    if (!clean) return
    setValue(clean)
    setOpen(false)
    inputRef.current?.blur()
    onSearch(clean)
  }

  return (
    <div style={{ position: 'relative', marginBottom: 18 }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        background: '#fff', border: '2.5px solid #1a1a1a',
        borderRadius: 99, boxShadow: '4px 4px 0 #1a1a1a',
        overflow: 'hidden', padding: '0 4px 0 16px',
      }}>
        {/* 돋보기 아이콘 */}
        <svg width="17" height="17" viewBox="0 0 17 17" fill="none" style={{ flexShrink: 0, opacity: 0.35 }}>
          <circle cx="7" cy="7" r="5" stroke="#1a1a1a" strokeWidth="2"/>
          <path d="M11 11L15 15" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round"/>
        </svg>

        <input
          ref={inputRef}
          value={value}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => value && open && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          onKeyDown={e => { if (e.key === 'Enter') submit(value) }}
          placeholder="캐릭터 이름 검색... (한국어 가능 ✓)"
          style={{
            flex: 1, border: 'none', outline: 'none',
            padding: '13px 10px', fontSize: 14, fontWeight: 700,
            background: 'transparent', fontFamily: "'Nunito Sans',sans-serif",
          }}
        />

        {value && (
          <button
            onClick={() => { setValue(''); setSuggest([]); setOpen(false); inputRef.current?.focus() }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 8px', color: '#bbb', fontSize: 22, lineHeight: 1, flexShrink: 0 }}
          >×</button>
        )}

        <button
          onClick={() => submit(value)}
          disabled={loading}
          style={{
            padding: '10px 22px', borderRadius: 99, margin: 4,
            background: loading ? '#e0e0e0' : 'linear-gradient(135deg,#FF6B9D,#C44BE0)',
            color: loading ? '#aaa' : '#fff',
            border: '2px solid #1a1a1a', fontWeight: 900, fontSize: 13,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: "'Nunito',sans-serif", whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '.85' }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          onMouseDown={e => { if (!loading) e.currentTarget.style.transform = 'scale(.97)' }}
          onMouseUp={e => { e.currentTarget.style.transform = 'none' }}
        >
          {loading ? '검색 중...' : '🔍 검색'}
        </button>
      </div>

      {/* 자동완성 */}
      {open && suggest.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 30,
          background: '#fff', border: '2px solid #1a1a1a', borderRadius: 16,
          boxShadow: '4px 4px 0 #1a1a1a', overflow: 'hidden',
        }}>
          {suggest.map((s, i) => {
            const tag = TAG_DICTIONARY[s]?.danbooru ?? toTag(s)
            return (
              <button
                key={s}
                onMouseDown={() => submit(s)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 16px', background: 'none', border: 'none',
                  borderBottom: i < suggest.length - 1 ? '0.5px solid #f5f5f5' : 'none',
                  cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#FFF0F5'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <span style={{ fontSize: 13, opacity: 0.4 }}>🔍</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', fontFamily: "'Nunito',sans-serif" }}>{s}</span>
                <span style={{ fontSize: 10, color: '#ccc', fontFamily: 'monospace', marginLeft: 'auto' }}>{tag}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  ArchiveDrawer
// ══════════════════════════════════════════════════════════════
function ArchiveDrawer({ open, onClose, plan, onPlanChange }) {
  const [archive, setArchive] = useState(loadArchive)
  const [folder,  setFolder]  = useState('default')
  const [newName, setNewName] = useState('')

  const refresh = () => setArchive(loadArchive())
  const current = archive.folders.find(f => f.id === folder) ?? archive.folders[0]
  const stats   = getArchiveStats()

  if (!open) return null

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.35)', display: 'flex', justifyContent: 'flex-end' }}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 320, maxWidth: '92vw', height: '100dvh', background: '#FFF0F8', border: '2.5px solid #1a1a1a', boxShadow: '-5px 0 0 #1a1a1a', display: 'flex', flexDirection: 'column', animation: 'slideInRight .22s ease', fontFamily: "'Nunito',sans-serif" }}
      >
        {/* 헤더 */}
        <div style={{ padding: '14px 16px', borderBottom: '2px solid #FFD6E8', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <p style={{ fontWeight: 900, fontSize: 15, margin: 0 }}>🎴 나의 굿즈 진열장</p>
            <p style={{ fontSize: 10, color: '#aaa', margin: 0 }}>
              {stats.isPremium ? '무제한' : `${stats.total} / ${stats.limit}`}개 저장됨
            </p>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 99, background: '#f0f0f0', border: '1.5px solid #ddd', cursor: 'pointer', fontSize: 18, fontWeight: 900, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* 플랜 토글 (데모) */}
        <div style={{ padding: '8px 14px', background: '#FFF8FC', borderBottom: '1.5px dashed #FFD6E8', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#888' }}>플랜:</span>
          {[['free','Free','#9CA3AF'],['premium','✨ Premium','#FF6B9D']].map(([id,lbl,col]) => (
            <button key={id} onClick={() => { setPlan(id); onPlanChange(id === 'premium' ? PLANS.PREMIUM : PLANS.FREE) }}
              style={{ padding: '3px 10px', borderRadius: 99, fontSize: 10, fontWeight: 900, border: '1.5px solid #1a1a1a', cursor: 'pointer', background: plan.id === id ? col : '#f0f0f0', color: plan.id === id ? '#fff' : '#888' }}>
              {lbl}
            </button>
          ))}
        </div>

        {/* 폴더 탭 */}
        <div style={{ padding: '8px 14px', borderBottom: '1.5px dashed #FFD6E8', display: 'flex', gap: 5, overflowX: 'auto', flexShrink: 0 }}>
          {archive.folders.map(f => (
            <button key={f.id} onClick={() => setFolder(f.id)}
              style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 900, border: '2px solid #1a1a1a', cursor: 'pointer', whiteSpace: 'nowrap', background: folder === f.id ? '#FF6B9D' : '#fff', color: folder === f.id ? '#fff' : '#1a1a1a', boxShadow: folder === f.id ? '2px 2px 0 #1a1a1a' : '1px 1px 0 #ccc' }}>
              {f.emoji} {f.name}
              {f.items.length > 0 && <span style={{ marginLeft: 3, fontSize: 9, background: 'rgba(0,0,0,.15)', borderRadius: 99, padding: '0 4px' }}>{f.items.length}</span>}
            </button>
          ))}
        </div>

        {/* 새 폴더 (Premium) */}
        {plan.id === 'premium' && (
          <div style={{ padding: '8px 14px', borderBottom: '1.5px dashed #FFD6E8', display: 'flex', gap: 5, flexShrink: 0 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="새 진열장 이름…"
              onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { createFolder(newName.trim(), '📦'); setNewName(''); refresh() } }}
              style={{ flex: 1, border: '2px solid #eee', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700, outline: 'none' }} />
            <button
              onClick={() => { if (newName.trim()) { createFolder(newName.trim(), '📦'); setNewName(''); refresh() } }}
              style={{ padding: '6px 12px', borderRadius: 8, background: '#A855F7', color: '#fff', border: '2px solid #1a1a1a', fontWeight: 900, fontSize: 11, cursor: 'pointer' }}>
              + 추가
            </button>
          </div>
        )}

        {/* 저장 목록 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!current?.items.length ? (
            <div style={{ textAlign: 'center', paddingTop: 40, color: '#ccc' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
              <p style={{ fontSize: 12, fontWeight: 700 }}>저장된 작품이 없어요</p>
              <p style={{ fontSize: 11, color: '#ddd' }}>이미지 클릭 후 💾 저장하세요</p>
            </div>
          ) : current.items.map(it => (
            <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#fff', borderRadius: 12, border: '2px solid #eee', padding: '8px 10px' }}>
              <img src={it.thumb ?? it.src} alt={it.title} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: '2px solid #1a1a1a', flexShrink: 0 }}
                onError={e => { e.target.style.display='none' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 900, fontSize: 11, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.title}</p>
                <p style={{ fontSize: 9, color: '#aaa', margin: 0 }}>{new Date(it.savedAt ?? it.date).toLocaleDateString('ko-KR')}</p>
              </div>
              <button onClick={() => { removeFromArchive(it.id); refresh() }}
                style={{ width: 22, height: 22, borderRadius: 99, background: '#f0f0f0', border: '1px solid #ddd', cursor: 'pointer', fontSize: 14, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                ×
              </button>
            </div>
          ))}
        </div>

        <div style={{ padding: '8px 14px', borderTop: '1.5px dashed #FFD6E8', background: '#fff8fc', flexShrink: 0 }}>
          <p style={{ fontSize: 9, color: '#ccc', margin: 0, lineHeight: 1.5 }}>{DISCLAIMER}</p>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  App Root
// ══════════════════════════════════════════════════════════════
export default function App() {
  const [plan,        setPlanState]  = useState(getCurrentPlan)
  const [results,     setResults]    = useState([])
  const [loading,     setLoading]    = useState(false)
  const [error,       setError]      = useState('')
  const [source,      setSource]     = useState('')   // 'Safebooru' | 'Gelbooru'
  const [sortTab,     setSortTab]    = useState('all')
  const [query,       setQuery]      = useState('')
  const [page,        setPage]       = useState(1)
  const [hasMore,     setHasMore]    = useState(false)
  const [selected,    setSelected]   = useState(null)
  const [drawerOpen,  setDrawer]     = useState(false)
  const [archiveTick, setTick]       = useState(0)
  const [searched,    setSearched]   = useState(false)

  const stats = getArchiveStats()

  const doSearch = useCallback(async (q, pg, tab) => {
    if (!q.trim()) return
    setQuery(q)
    setLoading(true)
    setError('')
    if (pg === 1) { setResults([]); setSearched(true); setPage(1) }

    try {
      const { results: data, source: src } = await searchImages(q, pg, tab)
      setSource(src)
      setResults(prev => pg === 1 ? data : [...prev, ...data])
      setHasMore(data.length >= 40)
      setPage(pg)
    } catch (e) {
      console.error(e)
      setError('검색 중 오류가 발생했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleTabChange = tab => {
    setSortTab(tab)
    if (query) doSearch(query, 1, tab)
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&family=Nunito+Sans:wght@400;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: #FEF0F8;
          background-image:
            radial-gradient(circle at 15% 15%, #FFE4F3 0%, transparent 40%),
            radial-gradient(circle at 85% 85%, #E8F4FF 0%, transparent 40%);
          min-height: 100vh;
          font-family: 'Nunito Sans', sans-serif;
        }
        @keyframes fadeIn        { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes shimmer       { 0%,100%{opacity:1} 50%{opacity:.45} }
        @keyframes spin          { to{transform:rotate(360deg)} }
        @keyframes slideInRight  { from{transform:translateX(110%)} to{transform:translateX(0)} }
        @keyframes logoBounce    { 0%,100%{transform:rotate(-3deg) scale(1)} 50%{transform:rotate(3deg) scale(1.05)} }
        ::-webkit-scrollbar      { width: 5px; }
        ::-webkit-scrollbar-thumb{ background: #FF6B9D; border-radius: 99px; }
        .img-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        @media(min-width: 480px) { .img-grid { grid-template-columns: repeat(3, 1fr); } }
        @media(min-width: 680px) { .img-grid { grid-template-columns: repeat(4, 1fr); } }
        .card-in { animation: fadeIn .28s ease both; }
      `}</style>

      <div style={{ maxWidth: 820, margin: '0 auto', padding: '16px 14px 48px' }}>

        {/* ── 헤더 ── */}
        <header style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 28, animation: 'logoBounce 2.5s ease-in-out infinite', display: 'inline-block' }}>🎴</span>
            <h1 style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 32, background: 'linear-gradient(135deg,#FF6B9D 0%,#A855F7 50%,#6366F1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.02em' }}>
              MemeBox
            </h1>
            <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 900, background: '#FEF08A', color: '#1a1a1a', border: '1.5px solid #1a1a1a' }}>v2.0</span>
          </div>
          <p style={{ fontSize: 12, color: '#bbb', fontWeight: 600, marginBottom: 10 }}>
            캐릭터 이름으로 전 세계 팬아트 검색 — 한국어 자동 변환 🌍
          </p>
          <button
            onClick={() => setDrawer(true)}
            style={{ padding: '6px 14px', borderRadius: 99, background: '#fff', border: '2px solid #FF6B9D', color: '#FF6B9D', fontWeight: 900, fontSize: 12, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", boxShadow: '2px 2px 0 #FF6B9D' }}
          >
            💾 나의 진열장 ({stats.total}{stats.isPremium ? '' : '/' + stats.limit})
          </button>
        </header>

        {/* ── 검색바 ── */}
        <SearchBar onSearch={q => doSearch(q, 1, sortTab)} loading={loading} />

        {/* ── 인기 검색어 (검색 전) ── */}
        {!searched && (
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 11, color: '#bbb', fontWeight: 700, marginBottom: 8, fontFamily: "'Nunito',sans-serif" }}>⚡ 인기 검색어</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {QUICK_TAGS.map(t => (
                <button
                  key={t}
                  onClick={() => doSearch(t, 1, sortTab)}
                  style={{ padding: '5px 13px', borderRadius: 99, fontSize: 12, fontWeight: 700, border: '2px solid #1a1a1a', background: '#fff', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", boxShadow: '2px 2px 0 #1a1a1a', transition: 'all .1s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#FFF0F5'; e.currentTarget.style.borderColor = '#FF6B9D'; e.currentTarget.style.color = '#FF6B9D' }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.color = '#1a1a1a' }}
                >{t}</button>
              ))}
            </div>
          </div>
        )}

        {/* ── 정렬 탭 + 결과 수 ── */}
        {searched && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 5 }}>
              {SORT_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => handleTabChange(tab.key)}
                  style={{ padding: '5px 12px', borderRadius: 10, fontSize: 11, fontWeight: 900, border: '2px solid #1a1a1a', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", background: sortTab === tab.key ? tab.color : '#fff', color: sortTab === tab.key ? '#fff' : '#1a1a1a', boxShadow: sortTab === tab.key ? '2px 2px 0 #1a1a1a' : '1px 1px 0 #ccc', transform: sortTab === tab.key ? 'translate(-1px,-1px)' : 'none', transition: 'all .1s' }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {source && (
                <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700, background: source === 'Gelbooru' ? '#E8F5E9' : '#E3F2FD', color: source === 'Gelbooru' ? '#2E7D32' : '#1565C0', border: `1px solid ${source === 'Gelbooru' ? '#A5D6A7' : '#90CAF9'}` }}>
                  {source}
                </span>
              )}
              <span style={{ fontSize: 11, color: '#bbb', fontWeight: 600 }}>"{query}" — {results.length}개</span>
            </div>
          </div>
        )}

        {/* ── 에러 ── */}
        {error && (
          <div style={{ padding: '12px 16px', borderRadius: 12, background: '#FFF0F0', border: '2px solid #FFB3B3', color: '#CC3333', fontSize: 12, fontWeight: 700, marginBottom: 12, fontFamily: "'Nunito',sans-serif" }}>
            ⚠️ {error}
          </div>
        )}

        {/* ── 로딩 (첫 검색) ── */}
        {loading && results.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ display: 'inline-block', width: 42, height: 42, border: '3px solid #FFD6E8', borderTopColor: '#FF6B9D', borderRadius: '50%', animation: 'spin .75s linear infinite' }} />
            <p style={{ marginTop: 14, fontFamily: "'Nunito',sans-serif", fontWeight: 700, color: '#bbb', fontSize: 13 }}>
              팬아트 검색 중...
            </p>
            <p style={{ fontSize: 11, color: '#ddd', marginTop: 4 }}>
              태그: <code style={{ background: '#f5f5f5', padding: '1px 6px', borderRadius: 4 }}>{toTag(query)}</code>
            </p>
          </div>
        )}

        {/* ── 결과 없음 ── */}
        {searched && !loading && results.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>😢</div>
            <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 15, color: '#888' }}>
              "{query}" 검색 결과가 없어요
            </p>
            <p style={{ fontSize: 12, color: '#bbb', marginTop: 6, marginBottom: 14 }}>
              다른 이름이나 영어로 검색해 보세요
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'center' }}>
              {QUICK_TAGS.slice(0, 6).map(t => (
                <button key={t} onClick={() => doSearch(t, 1, sortTab)}
                  style={{ padding: '4px 12px', borderRadius: 99, fontSize: 11, fontWeight: 700, border: '2px solid #1a1a1a', background: '#fff', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", boxShadow: '1px 1px 0 #ccc' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── 이미지 그리드 ── */}
        {results.length > 0 && (
          <div className="img-grid">
            {results.map((item, i) => (
              <div key={`${item.id}-${i}`} className="card-in" style={{ animationDelay: `${Math.min(i, 20) * 22}ms` }}>
                <ImageCard item={item} onClick={setSelected} />
              </div>
            ))}
          </div>
        )}

        {/* ── 더 보기 ── */}
        {hasMore && !loading && results.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <button
              onClick={() => doSearch(query, page + 1, sortTab)}
              style={{ padding: '10px 36px', borderRadius: 99, background: '#fff', border: '2.5px solid #1a1a1a', boxShadow: '3px 3px 0 #1a1a1a', fontWeight: 900, fontSize: 13, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", transition: 'all .1s' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translate(-1px,-1px)'; e.currentTarget.style.boxShadow = '4px 4px 0 #1a1a1a' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '3px 3px 0 #1a1a1a' }}
            >
              더 보기 ↓
            </button>
          </div>
        )}

        {/* ── 추가 로딩 ── */}
        {loading && results.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <div style={{ display: 'inline-block', width: 26, height: 26, border: '2.5px solid #FFD6E8', borderTopColor: '#FF6B9D', borderRadius: '50%', animation: 'spin .75s linear infinite' }} />
          </div>
        )}

        {/* ── 푸터 ── */}
        <footer style={{ marginTop: 32, paddingTop: 14, borderTop: '2px dashed #FFD6E8', textAlign: 'center' }}>
          <p style={{ fontSize: 10, color: '#bbb', fontWeight: 600, lineHeight: 1.6, maxWidth: 480, margin: '0 auto 6px' }}>{DISCLAIMER}</p>
          <p style={{ fontSize: 9, color: '#ddd', fontWeight: 600 }}>MemeBox — Powered by Safebooru / Gelbooru API 🎴</p>
        </footer>
      </div>

      {/* ── 라이트박스 ── */}
      {selected && (
        <LightBox item={selected} onClose={() => setSelected(null)} onArchiveChange={() => setTick(t => t + 1)} />
      )}

      {/* ── 진열장 드로어 ── */}
      <ArchiveDrawer open={drawerOpen} onClose={() => setDrawer(false)} plan={plan} onPlanChange={p => setPlanState(p)} />
    </>
  )
}
