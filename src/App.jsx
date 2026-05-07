import { useState, useRef, useCallback } from 'react'
import { TAG_DICTIONARY } from './core/searchEngine'
import {
  getCurrentPlan, setPlan, PLANS,
  archiveItem, removeFromArchive, isArchived,
  loadArchive, createFolder, getArchiveStats,
} from './core/archive'

// ══════════════════════════════════════════════════════════════
//  STEP 1: 이미지 → Claude AI 캐릭터 분석
//  Anthropic Messages API를 브라우저에서 직접 호출
//  (API 키는 환경변수 VITE_ANTHROPIC_KEY 에 저장)
// ══════════════════════════════════════════════════════════════
async function analyzeImageWithAI(base64, mimeType) {
  const apiKey = import.meta.env.VITE_ANTHROPIC_KEY
  if (!apiKey) {
    // API 키 없으면 태그 사전에서 랜덤 추천
    return {
      characters: ['분석 불가 (API 키 필요)'],
      tags: [],
      works: [],
    }
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: base64 },
          },
          {
            type: 'text',
            text: `이 이미지에서 애니메이션/만화/게임 캐릭터를 분석해주세요.
JSON만 반환하세요. 다른 텍스트 없이:
{
  "characters": ["캐릭터명1", "캐릭터명2"],
  "works": ["작품명1"],
  "tags": ["danbooru태그1", "danbooru태그2"],
  "confidence": 0.0~1.0
}
캐릭터를 모르면 characters를 빈 배열로, tags에 보이는 특징(hair_color, style 등)만 넣으세요.`,
          },
        ],
      }],
    }),
  })

  if (!res.ok) throw new Error(`AI API ${res.status}`)
  const data = await res.json()
  const text = data.content?.[0]?.text ?? '{}'
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    return { characters: [], tags: [], works: [] }
  }
}

// ══════════════════════════════════════════════════════════════
//  STEP 2: 태그 → Safebooru 실제 이미지 + 링크 검색
// ══════════════════════════════════════════════════════════════

/** 한국어/영어 → Danbooru 태그 */
function toTag(input) {
  const t = (input ?? '').trim()
  const entry = TAG_DICTIONARY[t] ?? TAG_DICTIONARY[t.toLowerCase()]
  if (entry) return entry.danbooru
  return t.toLowerCase().replace(/\s+/g, '_')
}

/**
 * Safebooru API
 * - CORS 완전 허용 (Access-Control-Allow-Origin: *)
 * - 전체이용가 전용
 * - 반환: 이미지 URL + 원본 링크 포함
 */
async function fetchFromSafebooru(tags, page = 1) {
  const tagStr = tags.map(toTag).filter(Boolean).join('+')
  if (!tagStr) return []

  const pid = page - 1
  const url =
    `https://safebooru.org/index.php?page=dapi&s=post&q=index` +
    `&json=1&limit=40&pid=${pid}` +
    `&tags=${encodeURIComponent(tagStr)}`

  const res  = await fetch(url)
  if (!res.ok) throw new Error(`Safebooru ${res.status}`)
  const raw  = await res.json()
  const posts = Array.isArray(raw) ? raw : (raw?.post ?? [])

  return posts
    .filter(p => p.preview_url || p.sample_url)
    .map(p => ({
      id:       `sb_${p.id}`,
      thumb:    p.preview_url ?? p.sample_url,
      large:    p.sample_url  ?? p.preview_url,
      pageUrl:  `https://safebooru.org/index.php?page=post&s=view&id=${p.id}`,
      source:   p.source || '',
      tags:     (p.tags ?? '').split(' ').filter(Boolean),
      score:    p.score ?? 0,
      width:    p.width  ?? 0,
      height:   p.height ?? 0,
      site:     'Safebooru',
    }))
}

/**
 * Gelbooru API (백업)
 */
async function fetchFromGelbooru(tags, page = 1) {
  const tagStr = tags.map(toTag).filter(Boolean).join('+') + '+rating:general'
  const pid    = page - 1
  const url =
    `https://gelbooru.com/index.php?page=dapi&s=post&q=index` +
    `&json=1&limit=40&pid=${pid}` +
    `&tags=${encodeURIComponent(tagStr)}`

  const res  = await fetch(url)
  if (!res.ok) throw new Error(`Gelbooru ${res.status}`)
  const raw  = await res.json()
  const posts = Array.isArray(raw) ? raw : (raw?.post ?? [])

  return posts
    .filter(p => p.preview_url || p.sample_url)
    .map(p => ({
      id:      `gb_${p.id}`,
      thumb:   p.preview_url ?? p.sample_url,
      large:   p.sample_url  ?? p.preview_url,
      pageUrl: `https://gelbooru.com/index.php?page=post&s=view&id=${p.id}`,
      source:  p.source || '',
      tags:    (p.tags ?? '').split(' ').filter(Boolean),
      score:   p.score ?? 0,
      width:   p.width  ?? 0,
      height:  p.height ?? 0,
      site:    'Gelbooru',
    }))
}

async function searchWithTags(tags, page = 1) {
  // Safebooru 먼저, 실패 시 Gelbooru
  try {
    const r = await fetchFromSafebooru(tags, page)
    if (r.length > 0) return { results: r, source: 'Safebooru' }
  } catch (e) {
    console.warn('Safebooru 실패, Gelbooru 시도…', e)
  }
  const r = await fetchFromGelbooru(tags, page)
  return { results: r, source: 'Gelbooru' }
}

// ══════════════════════════════════════════════════════════════
//  유틸
// ══════════════════════════════════════════════════════════════
const DISCLAIMER =
  '모든 이미지의 저작권은 원작자에게 있으며, 본 서비스는 검색 및 연결 서비스만 제공합니다.'

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload  = () => res(r.result.split(',')[1])
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

// ══════════════════════════════════════════════════════════════
//  컴포넌트: UploadZone
// ══════════════════════════════════════════════════════════════
function UploadZone({ file, preview, onFile, analyzing }) {
  const [drag, setDrag] = useState(false)
  const ref = useRef()

  const onDrop = e => {
    e.preventDefault(); setDrag(false)
    const f = e.dataTransfer.files?.[0]
    if (f?.type.startsWith('image/')) onFile(f)
  }

  return (
    <div
      onClick={() => !analyzing && ref.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
      style={{
        position: 'relative', minHeight: 160,
        border: `2.5px dashed ${drag ? '#FF6B9D' : preview ? '#A855F7' : '#ddd'}`,
        borderRadius: 16, cursor: analyzing ? 'default' : 'pointer',
        background: drag ? '#FFF0F5' : preview ? '#FAF0FF' : '#fafafa',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 6,
        overflow: 'hidden', transition: 'all .15s',
        boxShadow: drag ? '3px 3px 0 #FF6B9D' : 'none',
      }}
    >
      {preview ? (
        <>
          <img src={preview} alt="업로드 이미지"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {analyzing ? (
              <>
                <div style={{ width: 32, height: 32, border: '3px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
                <span style={{ color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: "'Nunito',sans-serif" }}>AI 분석 중...</span>
              </>
            ) : (
              <span style={{ color: '#fff', fontSize: 12, fontWeight: 900, padding: '5px 14px', background: 'rgba(0,0,0,.5)', borderRadius: 8, border: '2px solid #fff', fontFamily: "'Nunito',sans-serif" }}>
                🔄 이미지 변경
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 32 }}>📸</div>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#aaa', fontFamily: "'Nunito',sans-serif" }}>이미지를 드래그하거나 클릭</p>
          <p style={{ fontSize: 11, color: '#ccc' }}>JPG · PNG · WEBP · GIF</p>
          <p style={{ fontSize: 10, color: '#e0c0ff', fontWeight: 700 }}>⭐ 업로드 시 AI가 캐릭터를 자동 분석해요</p>
        </>
      )}
      <input ref={ref} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  컴포넌트: TagInput
// ══════════════════════════════════════════════════════════════
function TagInput({ tags, onAdd, onRemove, onClear }) {
  const [input, setInput]   = useState('')
  const [sugg,  setSugg]    = useState([])
  const [open,  setOpen]    = useState(false)
  const DICT_KEYS = Object.keys(TAG_DICTIONARY)

  const handleChange = v => {
    setInput(v)
    if (!v.trim()) { setSugg([]); setOpen(false); return }
    const q = v.toLowerCase()
    const s = DICT_KEYS.filter(k =>
      k.toLowerCase().includes(q) ||
      TAG_DICTIONARY[k]?.danbooru?.includes(q.replace(/\s/g,'_'))
    ).slice(0, 6)
    setSugg(s); setOpen(s.length > 0)
  }

  const add = v => {
    const t = v.trim().replace(/^#/, '')
    if (t && !tags.includes(t)) onAdd(t)
    setInput(''); setSugg([]); setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* 태그 목록 */}
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8, padding: '8px 10px', background: '#FFF8FC', border: '1.5px dashed #FFB3D1', borderRadius: 10 }}>
          {tags.map(t => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 99, border: '2px solid #FF6B9D', background: '#FFF0F5', color: '#FF6B9D', fontSize: 11, fontWeight: 900, fontFamily: "'Nunito',sans-serif" }}>
              #{t}
              <button onClick={() => onRemove(t)} style={{ width: 14, height: 14, borderRadius: 99, background: '#FF6B9D', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </span>
          ))}
          <button onClick={onClear} style={{ fontSize: 10, color: '#ccc', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Nunito',sans-serif", fontWeight: 700 }}>전체 삭제</button>
        </div>
      )}

      {/* 입력창 */}
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            value={input}
            onChange={e => handleChange(e.target.value)}
            onBlur={() => setTimeout(() => setOpen(false), 160)}
            onFocus={() => input && setOpen(sugg.length > 0)}
            onKeyDown={e => {
              if ((e.key === 'Enter' || e.key === ',') && input.trim()) { e.preventDefault(); add(input) }
              if (e.key === 'Backspace' && !input && tags.length) onRemove(tags[tags.length - 1])
            }}
            placeholder="태그 입력 후 Enter (예: hatsune_miku, 하츠네 미쿠...)"
            style={{ width: '100%', border: '2px solid #eee', borderRadius: 10, padding: '9px 12px', fontSize: 13, fontWeight: 700, outline: 'none', fontFamily: "'Nunito Sans',sans-serif", transition: 'border .15s, box-shadow .15s' }}
            onFocus={e => { e.target.style.border = '2px solid #FF6B9D'; e.target.style.boxShadow = '2px 2px 0 #FF6B9D' }}
            onBlur={e => { e.target.style.border = '2px solid #eee'; e.target.style.boxShadow = 'none' }}
          />
          {open && sugg.length > 0 && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: '#fff', border: '2px solid #1a1a1a', borderRadius: 12, boxShadow: '4px 4px 0 #1a1a1a', zIndex: 40, overflow: 'hidden' }}>
              {sugg.map(s => (
                <button key={s} onMouseDown={() => add(s)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'none', border: 'none', borderBottom: '0.5px solid #f5f5f5', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#FFF0F5'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', fontFamily: "'Nunito',sans-serif" }}>{s}</span>
                  <span style={{ fontSize: 10, color: '#bbb', fontFamily: 'monospace', marginLeft: 'auto' }}>{TAG_DICTIONARY[s]?.danbooru}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => { if (input.trim()) add(input) }}
          style={{ padding: '9px 14px', borderRadius: 10, background: '#FF6B9D', color: '#fff', border: '2px solid #1a1a1a', boxShadow: '2px 2px 0 #1a1a1a', fontWeight: 900, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: "'Nunito',sans-serif" }}
        >+ 추가</button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  컴포넌트: ResultCard (이미지 + 링크 모두 포함)
// ══════════════════════════════════════════════════════════════
function ResultCard({ item, onSelect }) {
  const [loaded,  setLoaded]  = useState(false)
  const [errored, setErrored] = useState(false)

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', background: '#f0f0f0', border: '2px solid #1a1a1a', boxShadow: '3px 3px 0 #1a1a1a', transition: 'transform .15s, box-shadow .15s', position: 'relative', display: 'flex', flexDirection: 'column' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translate(-2px,-2px)'; e.currentTarget.style.boxShadow = '5px 5px 0 #1a1a1a' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '3px 3px 0 #1a1a1a' }}
    >
      {/* 이미지 영역 — 클릭 시 라이트박스 */}
      <div onClick={() => onSelect(item)} style={{ cursor: 'zoom-in', position: 'relative', background: '#e8e8e8' }}>
        {!loaded && (
          <div style={{ height: 160, background: '#e8e8e8', animation: 'shimmer 1.4s ease infinite' }} />
        )}
        {errored && (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, background: '#f5f5f5' }}>🖼️</div>
        )}
        <img
          src={item.thumb} alt=""
          loading="lazy"
          style={{ width: '100%', display: loaded && !errored ? 'block' : 'none', objectFit: 'cover' }}
          onLoad={() => setLoaded(true)}
          onError={() => { setLoaded(true); setErrored(true) }}
        />
        {/* 점수 */}
        {item.score > 0 && (
          <span style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 6 }}>
            ♥ {item.score}
          </span>
        )}
        {/* 사이트 */}
        <span style={{ position: 'absolute', top: 5, left: 5, background: item.site === 'Gelbooru' ? '#1B5E20' : '#0D47A1', color: '#fff', fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 4 }}>
          {item.site}
        </span>
      </div>

      {/* 링크 영역 */}
      <div style={{ padding: '8px 10px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {/* 원본 페이지 링크 */}
        <a
          href={item.pageUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: item.site === 'Gelbooru' ? '#2E7D32' : '#1565C0', textDecoration: 'none', fontFamily: "'Nunito',sans-serif" }}
          onClick={e => e.stopPropagation()}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1 5.5H10M6.5 1.5L10 5.5L6.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          {item.site} 원본
        </a>

        {/* 이미지 직접 링크 */}
        <a
          href={item.large}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: '#A855F7', textDecoration: 'none', fontFamily: "'Nunito',sans-serif" }}
          onClick={e => e.stopPropagation()}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="1" y="1" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><circle cx="4" cy="4" r="1" fill="currentColor"/><path d="M1 7.5L3.5 5L5.5 7L7 6L10 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          고화질 이미지
        </a>

        {/* 출처 링크 (있을 때만) */}
        {item.source && item.source.startsWith('http') && (
          <a
            href={item.source}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#aaa', textDecoration: 'none', fontFamily: "'Nunito',sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onClick={e => e.stopPropagation()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M4 2H2a1 1 0 00-1 1v5a1 1 0 001 1h5a1 1 0 001-1V6M6 1h3m0 0v3m0-3L4.5 5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            출처 링크
          </a>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  컴포넌트: LightBox
// ══════════════════════════════════════════════════════════════
function LightBox({ item, onClose }) {
  const [saved, setSaved] = useState(() => isArchived(item.id))

  const handleSave = () => {
    if (saved) { removeFromArchive(item.id); setSaved(false); return }
    const r = archiveItem(item)
    if (r.success) setSaved(true)
    else if (r.reason === 'limit_reached') alert('무료 플랜 2개 한도 초과!\n진열장 > Premium으로 업그레이드하세요 ✨')
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 20, border: '2.5px solid #1a1a1a', boxShadow: '8px 8px 0 #1a1a1a', maxWidth: 640, width: '100%', maxHeight: '92dvh', overflowY: 'auto' }}
      >
        {/* 큰 이미지 */}
        <div style={{ background: '#111', borderRadius: '18px 18px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
          <img src={item.large} alt=""
            style={{ maxWidth: '100%', maxHeight: 460, objectFit: 'contain', display: 'block' }}
            onError={e => { e.target.src = item.thumb }}
          />
        </div>

        {/* 정보 + 링크 */}
        <div style={{ padding: '16px 18px', fontFamily: "'Nunito',sans-serif", display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* 사이트 + 점수 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ padding: '3px 10px', borderRadius: 99, background: item.site === 'Gelbooru' ? '#E8F5E9' : '#E3F2FD', color: item.site === 'Gelbooru' ? '#1B5E20' : '#0D47A1', fontSize: 11, fontWeight: 900, border: `1.5px solid ${item.site === 'Gelbooru' ? '#A5D6A7' : '#90CAF9'}` }}>
              {item.site}
            </span>
            {item.score > 0 && (
              <span style={{ fontSize: 12, fontWeight: 900, color: '#FF6B9D' }}>♥ {item.score}</span>
            )}
          </div>

          {/* 링크 3종 세트 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ fontSize: 11, fontWeight: 900, color: '#999', textTransform: 'uppercase', letterSpacing: '.06em', margin: 0 }}>링크</p>

            <a href={item.pageUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: item.site === 'Gelbooru' ? '#E8F5E9' : '#E3F2FD', border: `1.5px solid ${item.site === 'Gelbooru' ? '#A5D6A7' : '#90CAF9'}`, textDecoration: 'none', color: item.site === 'Gelbooru' ? '#1B5E20' : '#0D47A1', fontWeight: 700, fontSize: 13 }}>
              🔗 <span>{item.site} 원본 페이지 보기</span>
              <span style={{ marginLeft: 'auto', fontSize: 10, opacity: .6, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{item.pageUrl}</span>
            </a>

            <a href={item.large} target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: '#F3E8FF', border: '1.5px solid #C4B5FD', textDecoration: 'none', color: '#6D28D9', fontWeight: 700, fontSize: 13 }}>
              🖼️ <span>고화질 이미지 직접 열기</span>
              <span style={{ marginLeft: 'auto', fontSize: 10, opacity: .6 }}>{item.width && item.height ? `${item.width}×${item.height}` : 'Full size'}</span>
            </a>

            {item.source?.startsWith('http') && (
              <a href={item.source} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: '#FFF8F0', border: '1.5px solid #FCD34D', textDecoration: 'none', color: '#92400E', fontWeight: 700, fontSize: 13 }}>
                🌐 <span>원작자 출처 페이지</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, opacity: .6, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{item.source}</span>
              </a>
            )}
          </div>

          {/* 태그 목록 */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 900, color: '#999', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 6px' }}>태그</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {item.tags.slice(0, 20).map(t => (
                <span key={t} style={{ padding: '2px 7px', borderRadius: 99, background: '#f5f5f5', border: '1px solid #e0e0e0', fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
                  #{t}
                </span>
              ))}
            </div>
          </div>

          {/* 버튼 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleSave}
              style={{ flex: 1, padding: '10px 0', borderRadius: 12, background: saved ? '#FF6B9D' : '#fff', color: saved ? '#fff' : '#FF6B9D', border: '2px solid #FF6B9D', boxShadow: '2px 2px 0 #FF6B9D', fontWeight: 900, fontSize: 13, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}>
              {saved ? '💾 저장됨' : '💾 진열장에 저장'}
            </button>
            <button onClick={onClose}
              style={{ padding: '10px 16px', borderRadius: 12, background: '#f5f5f5', color: '#888', border: '2px solid #ddd', fontWeight: 900, fontSize: 16, cursor: 'pointer' }}>
              ✕
            </button>
          </div>

          <p style={{ fontSize: 9, color: '#ccc', lineHeight: 1.5, margin: 0 }}>{DISCLAIMER}</p>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
//  App Root
// ══════════════════════════════════════════════════════════════
export default function App() {
  // ── 상태 ──
  const [plan,          setPlanState]  = useState(getCurrentPlan)
  const [uploadedFile,  setUploadedFile] = useState(null)
  const [preview,       setPreview]    = useState('')
  const [analyzing,     setAnalyzing]  = useState(false)
  const [aiResult,      setAiResult]   = useState(null)   // { characters, tags, works, confidence }
  const [userTags,      setUserTags]   = useState([])
  const [results,       setResults]    = useState([])
  const [loading,       setLoading]    = useState(false)
  const [error,         setError]      = useState('')
  const [source,        setSource]     = useState('')
  const [page,          setPage]       = useState(1)
  const [hasMore,       setHasMore]    = useState(false)
  const [selected,      setSelected]   = useState(null)
  const [drawerOpen,    setDrawer]     = useState(false)
  const [archiveTick,   setTick]       = useState(0)
  const [searched,      setSearched]   = useState(false)
  const stats = getArchiveStats()

  // ── 이미지 업로드 → AI 분석 ──
  const handleFile = async file => {
    setUploadedFile(file)
    setPreview(URL.createObjectURL(file))
    setAiResult(null)
    setAnalyzing(true)

    try {
      const base64   = await fileToBase64(file)
      const mimeType = file.type || 'image/jpeg'
      const result   = await analyzeImageWithAI(base64, mimeType)
      setAiResult(result)

      // AI가 찾은 태그를 자동으로 userTags에 추가
      const autoTags = [
        ...(result.characters ?? []).map(toTag),
        ...(result.works      ?? []).map(toTag),
        ...(result.tags       ?? []),
      ].filter(Boolean)
      setUserTags(prev => [...new Set([...prev, ...autoTags])])
    } catch (e) {
      console.error('AI 분석 실패:', e)
      setAiResult({ characters: ['분석 실패'], tags: [], works: [] })
    } finally {
      setAnalyzing(false)
    }
  }

  // ── 태그로 이미지 검색 ──
  const handleSearch = useCallback(async (pg = 1) => {
    const allTags = userTags
    if (allTags.length === 0) { setError('태그를 하나 이상 입력하거나 이미지를 업로드하세요.'); return }

    setLoading(true); setError('')
    if (pg === 1) { setResults([]); setSearched(true) }

    try {
      const { results: data, source: src } = await searchWithTags(allTags, pg)
      setSource(src)
      setResults(prev => pg === 1 ? data : [...prev, ...data])
      setHasMore(data.length >= 40)
      setPage(pg)
    } catch (e) {
      setError('검색 오류가 발생했어요. 다시 시도해 주세요.')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [userTags])

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
        @keyframes spin         { to { transform: rotate(360deg); } }
        @keyframes shimmer      { 0%,100%{opacity:1} 50%{opacity:.45} }
        @keyframes fadeIn       { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
        @keyframes slideInRight { from{transform:translateX(110%)} to{transform:translateX(0)} }
        @keyframes logoBounce   { 0%,100%{transform:rotate(-3deg) scale(1)} 50%{transform:rotate(3deg) scale(1.05)} }
        ::-webkit-scrollbar      { width: 5px; }
        ::-webkit-scrollbar-thumb{ background: #FF6B9D; border-radius: 99px; }
        .grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }
        @media(min-width: 500px) { .grid { grid-template-columns: repeat(3, 1fr); } }
        @media(min-width: 700px) { .grid { grid-template-columns: repeat(4, 1fr); } }
        .card-in { animation: fadeIn .28s ease both; }
      `}</style>

      <div style={{ maxWidth: 840, margin: '0 auto', padding: '16px 14px 48px' }}>

        {/* ── 헤더 ── */}
        <header style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 28, animation: 'logoBounce 2.5s ease-in-out infinite', display: 'inline-block' }}>🎴</span>
            <h1 style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 32, background: 'linear-gradient(135deg,#FF6B9D 0%,#A855F7 50%,#6366F1 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.02em' }}>
              MemeBox
            </h1>
            <span style={{ padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 900, background: '#FEF08A', color: '#1a1a1a', border: '1.5px solid #1a1a1a' }}>v2.0</span>
          </div>
          <p style={{ fontSize: 12, color: '#bbb', fontWeight: 600, marginBottom: 10 }}>
            이미지 업로드 → AI 캐릭터 분석 → 실제 팬아트 이미지 + 링크 제공 🌍
          </p>
          <button onClick={() => setDrawer(true)}
            style={{ padding: '6px 14px', borderRadius: 99, background: '#fff', border: '2px solid #FF6B9D', color: '#FF6B9D', fontWeight: 900, fontSize: 12, cursor: 'pointer', fontFamily: "'Nunito',sans-serif", boxShadow: '2px 2px 0 #FF6B9D' }}>
            💾 나의 진열장 ({stats.total}{stats.isPremium ? '' : '/' + stats.limit})
          </button>
        </header>

        {/* ── 입력 패널 ── */}
        <div style={{ background: '#fff', border: '2.5px solid #1a1a1a', borderRadius: 20, boxShadow: '6px 6px 0 #1a1a1a', padding: 18, marginBottom: 16 }}>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>

            {/* 왼쪽: 이미지 업로드 */}
            <div>
              <p style={{ fontSize: 10, fontWeight: 900, color: '#999', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6, fontFamily: "'Nunito',sans-serif" }}>
                📸 이미지 업로드 (AI 자동 분석)
              </p>
              <UploadZone
                file={uploadedFile}
                preview={preview}
                onFile={handleFile}
                analyzing={analyzing}
              />
            </div>

            {/* 오른쪽: AI 결과 + 태그 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

              {/* AI 분석 결과 */}
              {aiResult && (
                <div style={{ padding: '10px 12px', background: '#F3E8FF', border: '2px solid #A855F7', borderRadius: 12, boxShadow: '2px 2px 0 #A855F7' }}>
                  <p style={{ fontSize: 11, fontWeight: 900, color: '#6D28D9', marginBottom: 6, fontFamily: "'Nunito',sans-serif" }}>
                    🤖 AI 분석 결과
                    {aiResult.confidence != null && (
                      <span style={{ marginLeft: 6, fontSize: 10, background: '#DDD6FE', padding: '1px 6px', borderRadius: 99 }}>
                        신뢰도 {Math.round(aiResult.confidence * 100)}%
                      </span>
                    )}
                  </p>
                  {aiResult.characters?.length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: '#7C3AED', fontWeight: 700 }}>캐릭터: </span>
                      {aiResult.characters.map(c => (
                        <span key={c} style={{ fontSize: 11, fontWeight: 700, color: '#4C1D95', background: '#EDE9FE', borderRadius: 99, padding: '1px 7px', marginRight: 4, cursor: 'pointer', border: '1px solid #C4B5FD' }}
                          onClick={() => { const t = toTag(c); if (!userTags.includes(t)) setUserTags(p => [...p, t]) }}>
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                  {aiResult.works?.length > 0 && (
                    <div>
                      <span style={{ fontSize: 10, color: '#7C3AED', fontWeight: 700 }}>작품: </span>
                      {aiResult.works.map(w => (
                        <span key={w} style={{ fontSize: 11, fontWeight: 700, color: '#4C1D95', background: '#EDE9FE', borderRadius: 99, padding: '1px 7px', marginRight: 4, cursor: 'pointer', border: '1px solid #C4B5FD' }}
                          onClick={() => { const t = toTag(w); if (!userTags.includes(t)) setUserTags(p => [...p, t]) }}>
                          {w}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {analyzing && (
                <div style={{ padding: '10px 12px', background: '#F3E8FF', border: '2px solid #A855F7', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 18, height: 18, border: '2px solid #C4B5FD', borderTopColor: '#7C3AED', borderRadius: '50%', animation: 'spin .7s linear infinite', flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#6D28D9', fontFamily: "'Nunito',sans-serif" }}>AI가 캐릭터를 분석하고 있어요...</span>
                </div>
              )}

              {!aiResult && !analyzing && (
                <div style={{ padding: '10px 12px', background: '#F3E8FF', border: '2px dashed #C4B5FD', borderRadius: 12 }}>
                  <p style={{ fontSize: 11, color: '#9333EA', fontWeight: 700, margin: 0, fontFamily: "'Nunito',sans-serif" }}>
                    👈 이미지를 업로드하면 AI가<br/>캐릭터를 자동으로 분석해요
                  </p>
                </div>
              )}

              {/* 직접 태그 입력 안내 */}
              <div style={{ padding: '8px 10px', background: '#FFF8FC', border: '1.5px dashed #FFB3D1', borderRadius: 10 }}>
                <p style={{ fontSize: 10, color: '#FF6B9D', fontWeight: 700, margin: 0, fontFamily: "'Nunito',sans-serif" }}>
                  ✏️ 아래에서 직접 태그를 추가하거나,<br/>AI 분석 결과 태그를 클릭해 추가하세요
                </p>
              </div>
            </div>
          </div>

          {/* 태그 입력 */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 10, fontWeight: 900, color: '#999', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6, fontFamily: "'Nunito',sans-serif" }}>
              🏷️ 검색 태그 ({userTags.length}개)
            </p>
            <TagInput
              tags={userTags}
              onAdd={t => setUserTags(p => [...new Set([...p, t])])}
              onRemove={t => setUserTags(p => p.filter(x => x !== t))}
              onClear={() => setUserTags([])}
            />
          </div>

          {/* 검색 버튼 */}
          <button
            onClick={() => handleSearch(1)}
            disabled={loading || userTags.length === 0}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 12,
              background: loading || userTags.length === 0
                ? '#e0e0e0'
                : 'linear-gradient(135deg, #FF6B9D 0%, #C44BE0 100%)',
              color: loading || userTags.length === 0 ? '#aaa' : '#fff',
              border: '2.5px solid #1a1a1a',
              boxShadow: loading || userTags.length === 0 ? 'none' : '4px 4px 0 #1a1a1a',
              fontWeight: 900, fontSize: 14, cursor: loading || userTags.length === 0 ? 'not-allowed' : 'pointer',
              fontFamily: "'Nunito',sans-serif", transition: 'all .1s',
            }}
            onMouseEnter={e => { if (!loading && userTags.length > 0) { e.currentTarget.style.transform = 'translate(-1px,-1px)'; e.currentTarget.style.boxShadow = '5px 5px 0 #1a1a1a' } }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = loading || userTags.length === 0 ? 'none' : '4px 4px 0 #1a1a1a' }}
            onMouseDown={e => { if (!loading && userTags.length > 0) { e.currentTarget.style.transform = 'translate(2px,2px)'; e.currentTarget.style.boxShadow = '1px 1px 0 #1a1a1a' } }}
            onMouseUp={e => { e.currentTarget.style.transform = 'none' }}
          >
            {loading ? '🔍 검색 중...' : userTags.length === 0 ? '태그를 추가하거나 이미지를 업로드하세요' : `🔍 팬아트 검색 (${userTags.length}개 태그)`}
          </button>
        </div>

        {/* ── 에러 ── */}
        {error && (
          <div style={{ padding: '12px 16px', borderRadius: 12, background: '#FFF0F0', border: '2px solid #FFB3B3', color: '#CC3333', fontSize: 13, fontWeight: 700, marginBottom: 12, fontFamily: "'Nunito',sans-serif" }}>
            ⚠️ {error}
          </div>
        )}

        {/* ── 로딩 ── */}
        {loading && results.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ display: 'inline-block', width: 44, height: 44, border: '3px solid #FFD6E8', borderTopColor: '#FF6B9D', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
            <p style={{ marginTop: 14, fontFamily: "'Nunito',sans-serif", fontWeight: 700, color: '#bbb', fontSize: 14 }}>팬아트 검색 중...</p>
            <p style={{ fontSize: 11, color: '#ddd', marginTop: 4 }}>
              태그: {userTags.map(t => <code key={t} style={{ background: '#f5f5f5', padding: '1px 5px', borderRadius: 4, marginRight: 3 }}>{t}</code>)}
            </p>
          </div>
        )}

        {/* ── 결과 헤더 ── */}
        {searched && !loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#888', fontFamily: "'Nunito',sans-serif" }}>
              검색 결과 <strong style={{ color: '#1a1a1a' }}>{results.length}개</strong>
            </p>
            {source && (
              <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 10, fontWeight: 900, background: source === 'Gelbooru' ? '#E8F5E9' : '#E3F2FD', color: source === 'Gelbooru' ? '#1B5E20' : '#0D47A1', border: `1.5px solid ${source === 'Gelbooru' ? '#A5D6A7' : '#90CAF9'}` }}>
                {source} 데이터
              </span>
            )}
          </div>
        )}

        {/* ── 결과 없음 ── */}
        {searched && !loading && results.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>😢</div>
            <p style={{ fontFamily: "'Nunito',sans-serif", fontWeight: 900, fontSize: 15, color: '#888' }}>결과가 없어요</p>
            <p style={{ fontSize: 12, color: '#bbb', marginTop: 6 }}>태그를 줄이거나 다른 태그로 시도해 보세요</p>
          </div>
        )}

        {/* ── 이미지 그리드 ── */}
        {results.length > 0 && (
          <div className="grid">
            {results.map((item, i) => (
              <div key={`${item.id}-${i}`} className="card-in" style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}>
                <ResultCard item={item} onSelect={setSelected} />
              </div>
            ))}
          </div>
        )}

        {/* ── 더 보기 ── */}
        {hasMore && !loading && results.length > 0 && (
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <button
              onClick={() => handleSearch(page + 1)}
              style={{ padding: '10px 36px', borderRadius: 99, background: '#fff', border: '2.5px solid #1a1a1a', boxShadow: '3px 3px 0 #1a1a1a', fontWeight: 900, fontSize: 13, cursor: 'pointer', fontFamily: "'Nunito',sans-serif" }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translate(-1px,-1px)'; e.currentTarget.style.boxShadow = '4px 4px 0 #1a1a1a' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '3px 3px 0 #1a1a1a' }}
            >더 보기 ↓</button>
          </div>
        )}

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
      {selected && <LightBox item={selected} onClose={() => { setSelected(null); setTick(t => t + 1) }} />}

      {/* ── 진열장 드로어 ── */}
      {drawerOpen && (
        <div onClick={() => setDrawer(false)} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.35)', display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 320, maxWidth: '92vw', height: '100dvh', background: '#FFF0F8', border: '2.5px solid #1a1a1a', boxShadow: '-5px 0 0 #1a1a1a', display: 'flex', flexDirection: 'column', animation: 'slideInRight .22s ease', fontFamily: "'Nunito',sans-serif" }}>
            <div style={{ padding: '14px 16px', borderBottom: '2px solid #FFD6E8', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <p style={{ fontWeight: 900, fontSize: 15, margin: 0 }}>🎴 나의 굿즈 진열장</p>
                <p style={{ fontSize: 10, color: '#aaa', margin: 0 }}>{stats.isPremium ? '무제한' : `${stats.total}/${stats.limit}`}개 저장됨</p>
              </div>
              <button onClick={() => setDrawer(false)} style={{ width: 28, height: 28, borderRadius: 99, background: '#f0f0f0', border: '1.5px solid #ddd', cursor: 'pointer', fontSize: 18, fontWeight: 900, color: '#888', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            <div style={{ padding: '8px 14px', background: '#FFF8FC', borderBottom: '1.5px dashed #FFD6E8', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#888' }}>플랜:</span>
              {[['free','Free','#9CA3AF'],['premium','✨ Premium','#FF6B9D']].map(([id,lbl,col]) => (
                <button key={id} onClick={() => { setPlan(id); setPlanState(id === 'premium' ? PLANS.PREMIUM : PLANS.FREE) }}
                  style={{ padding: '3px 10px', borderRadius: 99, fontSize: 10, fontWeight: 900, border: '1.5px solid #1a1a1a', cursor: 'pointer', background: plan.id === id ? col : '#f0f0f0', color: plan.id === id ? '#fff' : '#888' }}>
                  {lbl}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
              <div style={{ textAlign: 'center', paddingTop: 40, color: '#ccc' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
                <p style={{ fontSize: 12, fontWeight: 700 }}>이미지 카드의 💾 버튼으로 저장하세요</p>
              </div>
            </div>
            <div style={{ padding: '8px 14px', borderTop: '1.5px dashed #FFD6E8', background: '#fff8fc', flexShrink: 0 }}>
              <p style={{ fontSize: 9, color: '#ccc', margin: 0, lineHeight: 1.5 }}>{DISCLAIMER}</p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
