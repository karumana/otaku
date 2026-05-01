// ============================================================
//  MemeBox v2.0 — 아카이브 & 구독 관리
//  src/core/archive.js
// ============================================================

const ARCHIVE_KEY   = 'memebox_archive_v2'
const USER_PLAN_KEY = 'memebox_user_plan'

export const PLANS = {
  FREE:    { id: 'free',    archiveLimit: 2,       label: 'Free',    color: '#9CA3AF' },
  PREMIUM: { id: 'premium', archiveLimit: Infinity, label: 'Premium', color: '#FF6B9D' },
}

export const getCurrentPlan = () => {
  try { return localStorage.getItem(USER_PLAN_KEY) === 'premium' ? PLANS.PREMIUM : PLANS.FREE }
  catch { return PLANS.FREE }
}

export const setPlan = id => {
  try { localStorage.setItem(USER_PLAN_KEY, id) } catch {}
}

export const loadArchive = () => {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY)
    return raw ? JSON.parse(raw) : { folders: [{ id: 'default', name: '기본 진열장', emoji: '🎴', items: [] }] }
  } catch {
    return { folders: [{ id: 'default', name: '기본 진열장', emoji: '🎴', items: [] }] }
  }
}

const saveArchive = data => {
  try { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(data)) } catch {}
}

const totalArchived = archive =>
  archive.folders.reduce((sum, f) => sum + f.items.length, 0)

export const archiveItem = (item, folderId = 'default') => {
  const plan    = getCurrentPlan()
  const archive = loadArchive()

  if (archive.folders.some(f => f.items.some(i => i.id === item.id)))
    return { success: false, reason: 'already_saved' }

  if (plan.id === 'free' && totalArchived(archive) >= plan.archiveLimit)
    return { success: false, reason: 'limit_reached' }

  const folder = archive.folders.find(f => f.id === folderId)
  if (!folder) return { success: false, reason: 'folder_not_found' }

  folder.items.push({ ...item, savedAt: new Date().toISOString() })
  saveArchive(archive)
  return { success: true }
}

export const removeFromArchive = itemId => {
  const archive = loadArchive()
  archive.folders.forEach(f => { f.items = f.items.filter(i => i.id !== itemId) })
  saveArchive(archive)
}

export const isArchived = itemId =>
  loadArchive().folders.some(f => f.items.some(i => i.id === itemId))

export const createFolder = (name, emoji = '📦') => {
  if (getCurrentPlan().id === 'free') return { success: false, reason: 'premium_required' }
  const archive = loadArchive()
  const newFolder = { id: `folder_${Date.now()}`, name, emoji, items: [] }
  archive.folders.push(newFolder)
  saveArchive(archive)
  return { success: true, folder: newFolder }
}

export const deleteFolder = folderId => {
  if (folderId === 'default') return { success: false, reason: 'cannot_delete_default' }
  const archive = loadArchive()
  archive.folders = archive.folders.filter(f => f.id !== folderId)
  saveArchive(archive)
  return { success: true }
}

export const getArchiveStats = () => {
  const archive = loadArchive()
  const plan    = getCurrentPlan()
  const total   = totalArchived(archive)
  return {
    total,
    limit:     plan.archiveLimit,
    remaining: plan.archiveLimit === Infinity ? Infinity : plan.archiveLimit - total,
    isPremium: plan.id === 'premium',
    folders:   archive.folders.length,
  }
}
