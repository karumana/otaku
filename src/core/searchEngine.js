// ============================================================
//  MemeBox v2.0 — 검색 엔진 코어
//  src/core/searchEngine.js
// ============================================================

// ─── 다국어 태그 사전 ───────────────────────────────────────
export const TAG_DICTIONARY = {
  // Vocaloid
  "하츠네 미쿠":   { en: "hatsune miku",     ja: "初音ミク",          danbooru: "hatsune_miku",      deviantart: "hatsune-miku"    },
  "미쿠":          { en: "hatsune miku",     ja: "初音ミク",          danbooru: "hatsune_miku",      deviantart: "hatsune-miku"    },
  "메구리네 루카": { en: "megurine luka",    ja: "巡音ルカ",          danbooru: "megurine_luka",     deviantart: "megurine-luka"   },
  "카가미네":      { en: "kagamine rin len", ja: "鏡音リン・レン",    danbooru: "kagamine_rin",      deviantart: "kagamine-rin"    },
  "보컬로이드":    { en: "vocaloid",         ja: "VOCALOID",          danbooru: "vocaloid",           deviantart: "vocaloid"        },

  // 주술회전
  "고죠 사토루":   { en: "gojo satoru",      ja: "五条悟",            danbooru: "gojou_satoru",      deviantart: "gojo-satoru"     },
  "이타도리":      { en: "yuji itadori",     ja: "虎杖悠仁",          danbooru: "itadori_yuuji",     deviantart: "itadori-yuji"    },
  "노바라":        { en: "nobara kugisaki",  ja: "釘崎野薔薇",        danbooru: "kugisaki_nobara",   deviantart: "nobara-kugisaki" },
  "주술회전":      { en: "jujutsu kaisen",   ja: "呪術廻戦",          danbooru: "jujutsu_kaisen",    deviantart: "jujutsu-kaisen"  },

  // 원피스
  "루피":          { en: "monkey d luffy",   ja: "モンキー・D・ルフィ",danbooru: "monkey_d_luffy",   deviantart: "monkey-d-luffy"  },
  "조로":          { en: "roronoa zoro",     ja: "ロロノア・ゾロ",    danbooru: "roronoa_zoro",      deviantart: "zoro"            },
  "나미":          { en: "nami one piece",   ja: "ナミ",              danbooru: "nami_(one_piece)",  deviantart: "nami-one-piece"  },
  "원피스":        { en: "one piece",        ja: "ワンピース",        danbooru: "one_piece",          deviantart: "one-piece"       },

  // 귀멸의 칼날
  "탄지로":        { en: "tanjiro kamado",   ja: "竈門炭治郎",        danbooru: "kamado_tanjirou",   deviantart: "tanjiro-kamado"  },
  "네즈코":        { en: "nezuko kamado",    ja: "竈門禰豆子",        danbooru: "kamado_nezuko",     deviantart: "nezuko"          },
  "귀멸":          { en: "demon slayer",     ja: "鬼滅の刃",          danbooru: "kimetsu_no_yaiba",  deviantart: "demon-slayer"    },

  // 진격의 거인
  "에렌":          { en: "eren yeager",      ja: "エレン・イェーガー",danbooru: "eren_yeager",       deviantart: "eren-yeager"     },
  "미카사":        { en: "mikasa ackerman",  ja: "ミカサ・アッカーマン",danbooru:"mikasa_ackerman",  deviantart: "mikasa-ackerman" },
  "진격":          { en: "attack on titan",  ja: "進撃の巨人",        danbooru: "shingeki_no_kyojin",deviantart: "attack-on-titan" },

  // 오시의 아이
  "호시노 아이":   { en: "hoshino ai",       ja: "星野アイ",          danbooru: "hoshino_ai",        deviantart: "hoshino-ai"      },
  "오시노코":      { en: "oshi no ko",       ja: "【推しの子】",       danbooru: "oshi_no_ko",        deviantart: "oshi-no-ko"      },

  // 나루토
  "나루토":        { en: "naruto uzumaki",   ja: "うずまきナルト",    danbooru: "uzumaki_naruto",    deviantart: "naruto"          },
  "사스케":        { en: "sasuke uchiha",    ja: "うちはサスケ",      danbooru: "uchiha_sasuke",     deviantart: "sasuke-uchiha"   },

  // 블루 아카이브
  "블루아카":      { en: "blue archive",     ja: "ブルーアーカイブ",  danbooru: "blue_archive",      deviantart: "blue-archive"    },

  // 젤다
  "링크":          { en: "link zelda",       ja: "リンク",            danbooru: "link_(zelda)",      deviantart: "link-zelda"      },
  "젤다":          { en: "zelda",            ja: "ゼルダ",            danbooru: "zelda_(series)",    deviantart: "legend-of-zelda" },

  // 일반 태그
  "팬아트":        { en: "fanart",           ja: "ファンアート",      danbooru: "fan_art",           deviantart: "fanart"          },
  "코스플레이":    { en: "cosplay",          ja: "コスプレ",          danbooru: "cosplay",           deviantart: "cosplay"         },
  "스케치":        { en: "sketch",           ja: "スケッチ",          danbooru: "sketch",            deviantart: "sketch"          },
  "수채화":        { en: "watercolor",       ja: "水彩",              danbooru: "watercolor",        deviantart: "watercolor"      },
}

const enc = s => encodeURIComponent(s)

/**
 * 한국어/영어 혼용 입력 → 사이트별 최적 검색 URL 생성
 */
export function translateToQueries(input, tags = []) {
  const rawTokens = [input, ...tags]
    .join(' ')
    .split(/[\s,+#]+/)
    .map(t => t.trim())
    .filter(Boolean)

  const translated = rawTokens.map(token => {
    const entry = TAG_DICTIONARY[token] ?? TAG_DICTIONARY[token.toLowerCase()]
    if (entry) return entry
    const normalized = token.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_')
    return { en: token.toLowerCase(), ja: token.toLowerCase(), danbooru: normalized, deviantart: normalized.replace(/_/g, '-') }
  })

  const enTerms      = translated.map(t => t.en).join(' ')
  const jaTerms      = translated.map(t => t.ja).join(' ')
  const danbooruTags = translated.map(t => t.danbooru).join('+')
  const deviantTags  = translated.map(t => t.deviantart).join('+')

  if (!enTerms.trim()) return {}

  return {
    pixiv:      `https://www.pixiv.net/search.php?word=${enc(jaTerms)}&s_mode=s_tag`,
    danbooru:   `https://danbooru.donmai.us/posts?tags=${enc(danbooruTags)}`,
    gelbooru:   `https://gelbooru.com/index.php?page=post&s=list&tags=${enc(danbooruTags)}`,
    twitter:    `https://twitter.com/search?q=${enc(enTerms + ' fanart')}&f=image`,
    artstation: `https://www.artstation.com/search?query=${enc(enTerms)}&sort_by=likes_count`,
    deviantart: `https://www.deviantart.com/search?q=${enc(deviantTags)}`,
    pinterest:  `https://www.pinterest.com/search/pins/?q=${enc(enTerms + ' fanart')}`,
    zerochan:   `https://www.zerochan.net/${enc(jaTerms.split(' ')[0])}?s=fav`,
  }
}

// ─── 사이트 신뢰도 가중치 ───────────────────────────────────
const SITE_TRUST = {
  pixiv: 1.0, artstation: 0.95, danbooru: 0.85,
  gelbooru: 0.75, deviantart: 0.80, zerochan: 0.70,
  twitter: 0.65, pinterest: 0.55,
}

/**
 * 인기도 복합 점수 정렬
 * score = 품질(likes+views 로그) × 0.50
 *       + 최신성(지수감쇠 30일) × 0.30
 *       + 사이트신뢰                × 0.15
 *       + 카테고리보너스            (최대 0.10)
 */
export function rankItems(items, mode = 'popularity') {
  if (mode === 'recent') {
    return [...items].sort((a, b) => new Date(b.date) - new Date(a.date))
  }
  return [...items]
    .map(item => {
      const likesScore   = Math.log10(Math.max(item.likes  ?? 1, 1)) / 6
      const viewsScore   = Math.log10(Math.max(item.views  ?? 1, 1)) / 8
      const qualityScore = Math.min((likesScore + viewsScore) / 2, 1)
      const daysSince    = (Date.now() - new Date(item.date)) / 86_400_000
      const recencyScore = Math.exp(-daysSince / 30)
      const trustScore   = SITE_TRUST[item.site] ?? 0.5
      const catBonus     = item.category === 'official' ? 0.10 : item.category === 'high_quality' ? 0.05 : 0
      const finalScore   = qualityScore * 0.50 + recencyScore * 0.30 + trustScore * 0.15 + catBonus
      return { ...item, _score: finalScore }
    })
    .sort((a, b) => b._score - a._score)
}

// ─── Mock 데이터 ────────────────────────────────────────────
export const MOCK_ITEMS = [
  { id:1,  title:"初音ミク — 桜 Ver.",          artist:"@miuki_draw",      likes:48200,  views:920000,  date:"2025-04-18", tags:["hatsune_miku","sakura","spring"],       category:"official",     site:"pixiv",      src:"https://picsum.photos/seed/miku1/360/460",    badge:"✦ Official", badgeColor:"#A855F7" },
  { id:2,  title:"五条悟 — 無下限領域展開",      artist:"@jjk_arts",        likes:31500,  views:710000,  date:"2025-04-20", tags:["gojou_satoru","blue","domain"],         category:"high_quality", site:"danbooru",   src:"https://picsum.photos/seed/gojo2/360/440",    badge:"★ HQ",       badgeColor:"#F59E0B" },
  { id:3,  title:"Zero Two — Sketch Study",      artist:"@sketchlab_x",     likes:5200,   views:84000,   date:"2025-04-22", tags:["zero_two","sketch","darling"],          category:"sketch",       site:"twitter",    src:"https://picsum.photos/seed/zerotwo3/360/420", badge:"✏ Sketch",   badgeColor:"#6366F1" },
  { id:4,  title:"Sailor Moon — IRL Cosplay",    artist:"@moonprism_cos",   likes:22000,  views:430000,  date:"2025-04-23", tags:["sailor_moon","cosplay","irl"],          category:"cosplay",      site:"twitter",    src:"https://picsum.photos/seed/sailor4/360/480",  badge:"🌙 Cosplay", badgeColor:"#EC4899" },
  { id:5,  title:"Gear 5 Luffy — God Form",      artist:"@onepiece_fan99",  likes:9100,   views:177000,  date:"2025-04-24", tags:["monkey_d_luffy","gear5","one_piece"],   category:"recent",       site:"pixiv",      src:"https://picsum.photos/seed/luffy5/360/450",   badge:"⚡ Recent",  badgeColor:"#10B981" },
  { id:6,  title:"星野アイ — Idol Stage Night",  artist:"@oshinoko_studio", likes:61000,  views:1200000, date:"2025-03-31", tags:["hoshino_ai","concert","idol"],          category:"high_quality", site:"pixiv",      src:"https://picsum.photos/seed/hoshino6/360/500", badge:"★ HQ",       badgeColor:"#F59E0B" },
  { id:7,  title:"Eren Yeager — Rumbling",        artist:"@aoetitan",        likes:3300,   views:62000,   date:"2025-04-21", tags:["eren_yeager","titan","rumbling"],       category:"sketch",       site:"danbooru",   src:"https://picsum.photos/seed/eren7/360/420",    badge:"✏ Sketch",   badgeColor:"#6366F1" },
  { id:8,  title:"Misaka Mikoto — Railgun",       artist:"@railgun_arts",    likes:18700,  views:350000,  date:"2025-04-19", tags:["misaka_mikoto","electric","railgun"],   category:"official",     site:"danbooru",   src:"https://picsum.photos/seed/mikoto8/360/460",  badge:"✦ Official", badgeColor:"#A855F7" },
  { id:9,  title:"Miku × Luka — Duo Concert",    artist:"@vocaloid_club",   likes:27400,  views:510000,  date:"2025-04-17", tags:["hatsune_miku","luka","vocaloid"],       category:"recent",       site:"twitter",    src:"https://picsum.photos/seed/mikaluka9/360/440",badge:"⚡ Recent",  badgeColor:"#10B981" },
  { id:10, title:"Naruto — Sage Mode Cosplay",    artist:"@sage_coscraft",   likes:14200,  views:278000,  date:"2025-04-15", tags:["uzumaki_naruto","cosplay","sage"],      category:"cosplay",      site:"twitter",    src:"https://picsum.photos/seed/naruto10/360/470", badge:"🌙 Cosplay", badgeColor:"#EC4899" },
  { id:11, title:"Tanjiro vs Muzan — Final Arc",  artist:"@kimetsu_pro",     likes:55000,  views:980000,  date:"2025-04-10", tags:["tanjiro","muzan","battle","demon"],     category:"high_quality", site:"artstation", src:"https://picsum.photos/seed/tanjiro11/360/460",badge:"★ HQ",       badgeColor:"#F59E0B" },
  { id:12, title:"Link — Tears of the Kingdom",   artist:"@zelda_fanworks",  likes:8800,   views:164000,  date:"2025-04-12", tags:["link","zelda","totk"],                 category:"recent",       site:"deviantart", src:"https://picsum.photos/seed/link12/360/440",   badge:"⚡ Recent",  badgeColor:"#10B981" },
  { id:13, title:"Blue Archive — Sensei Chibi",   artist:"@ba_chibi_club",   likes:12400,  views:241000,  date:"2025-04-05", tags:["blue_archive","chibi","cute"],          category:"official",     site:"pixiv",      src:"https://picsum.photos/seed/bluearch13/360/420",badge:"✦ Official",badgeColor:"#A855F7" },
  { id:14, title:"Gojo Satoru — Portrait Study",  artist:"@fineart_jjk",     likes:7600,   views:130000,  date:"2025-04-08", tags:["gojou_satoru","portrait","study"],      category:"sketch",       site:"artstation", src:"https://picsum.photos/seed/gojo14/360/460",   badge:"✏ Sketch",   badgeColor:"#6366F1" },
  { id:15, title:"미쿠 — 봄밤 수채화",             artist:"@watercolor_miku", likes:33100,  views:620000,  date:"2025-04-25", tags:["hatsune_miku","watercolor","spring"],   category:"high_quality", site:"pixiv",      src:"https://picsum.photos/seed/mikuspring15/360/480",badge:"★ HQ",   badgeColor:"#F59E0B" },
  { id:16, title:"Nezuko — Demon Form",            artist:"@kimetsu_illust",  likes:19800,  views:390000,  date:"2025-04-03", tags:["kamado_nezuko","demon","kimetsu"],      category:"official",     site:"pixiv",      src:"https://picsum.photos/seed/nezuko16/360/460", badge:"✦ Official", badgeColor:"#A855F7" },
  { id:17, title:"Sasuke — Eternal Mangekyou",     artist:"@uchiha_fan",      likes:16300,  views:305000,  date:"2025-04-02", tags:["uchiha_sasuke","naruto","sharingan"],   category:"high_quality", site:"deviantart", src:"https://picsum.photos/seed/sasuke17/360/440", badge:"★ HQ",       badgeColor:"#F59E0B" },
  { id:18, title:"Kagamine Rin — Electric Angel",  artist:"@rin_artwork",     likes:24100,  views:460000,  date:"2025-03-28", tags:["kagamine_rin","vocaloid","angel"],      category:"official",     site:"pixiv",      src:"https://picsum.photos/seed/rin18/360/480",    badge:"✦ Official", badgeColor:"#A855F7" },
]
