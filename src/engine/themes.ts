// Theme extraction without paid APIs: a curated, user-editable taxonomy plus TF-IDF term clusters.
import { cmpVersion } from './reviews.ts'
import { MIN_N } from './stats.ts'
import type { Review, ThemeRule } from './types.ts'

export const DEFAULT_RULES: ThemeRule[] = [
  { id: 'crash', label: 'Crashes', keywords: ['crash', 'crashes', 'crashing', 'crashed', 'force close', 'closes itself', 'quits', 'freezes', 'frozen', 'wont open', "won't open", 'will not open', 'not opening', 'black screen', 'white screen'] },
  { id: 'login', label: 'Login and account', keywords: ['login', 'log in', 'logged out', 'sign in', 'signin', 'password', 'account locked', 'verification code', '2fa', 'cant log', "can't log", 'locked out'] },
  { id: 'paywall', label: 'Subscription and paywall', keywords: ['subscription', 'subscribe', 'paywall', 'premium', 'paid', 'pay for', 'price', 'pricing', 'expensive', 'charged', 'refund', 'free trial', 'trial', 'money grab', 'cash grab', 'per month', 'per year', 'lifetime'] },
  { id: 'ads', label: 'Ads', keywords: ['ads', 'ad', 'advert', 'adverts', 'advertisement', 'advertisements', 'commercial', 'commercials', 'pop up', 'popup', 'pop-ups'] },
  { id: 'sync', label: 'Sync and data loss', keywords: ['sync', 'syncing', 'icloud', 'backup', 'restore', 'lost my data', 'lost all', 'data loss', 'disappeared', 'deleted my', 'gone', 'across devices'] },
  { id: 'battery', label: 'Battery and heat', keywords: ['battery', 'drain', 'drains', 'draining', 'overheat', 'overheating', 'hot', 'heats up'] },
  { id: 'ui', label: 'UI change', keywords: ['new design', 'redesign', 'new ui', 'new layout', 'new update', 'bring back', 'old version', 'old design', 'confusing', 'cluttered', 'interface', 'layout', 'harder to find', 'moved'] },
  { id: 'missing', label: 'Missing feature', keywords: ['please add', 'wish', 'would be great', 'would be nice', 'feature request', 'missing', 'no option', 'needs a', 'should have', 'dark mode', 'widget', 'apple watch', 'ipad version', 'export'] },
  { id: 'performance', label: 'Performance', keywords: ['slow', 'laggy', 'lag', 'lags', 'sluggish', 'loading', 'takes forever', 'spinning', 'unresponsive', 'stutter'] },
  { id: 'update-bug', label: 'Bug after update', keywords: ['since the update', 'since update', 'after the update', 'after update', 'after updating', 'latest update', 'last update', 'recent update', 'new version', 'this update', 'broke', 'broken', 'stopped working', 'no longer works', 'doesnt work anymore', "doesn't work anymore"] },
].map(r => ({ ...r, builtin: true, enabled: true }))

/**
 * Translations of the built-in themes for the larger non-English storefronts. They apply to a built-in rule
 * for as long as it is enabled and are not stored with the project, so editing the English keywords never loses them.
 * Japanese has no spaces between words, so those phrases match anywhere in the text.
 */
export const INTL: Record<string, string[]> = {
  crash: ['stürzt ab', 'stürzt ständig ab', 'absturz', 'abstürze', 'abgestürzt', 'hängt sich auf', 'öffnet sich nicht', 'startet nicht', 'plante', 'plantage', 'crashe', 'ne s’ouvre pas', 'ne se lance pas', 'se cierra', 'se cierra sola', 'se cuelga', 'no abre', 'no se abre', 'trava', 'travando', 'fecha sozinho', 'não abre', 'si blocca', 'si chiude', 'non si apre', 'クラッシュ', '落ちる', '落ちます', '強制終了', '起動しない', '開けない', '開かない', 'フリーズ'],
  login: ['anmelden', 'anmeldung', 'einloggen', 'passwort', 'connexion', 'me connecter', 'se connecter', 'mot de passe', 'iniciar sesión', 'contraseña', 'senha', 'fazer login', 'entrar na conta', 'accedere', 'accesso', 'ログイン', 'パスワード', 'サインイン'],
  paywall: ['abo', 'abonnement', 'abos', 'kostenpflichtig', 'bezahlen', 'teuer', 'zu teuer', 'abzocke', 'abonnement payant', 'payant', 'payante', 'trop cher', 'payer', 'suscripción', 'de pago', 'caro', 'muy caro', 'pagar', 'cobran', 'assinatura', 'pago', 'cobrança', 'abbonamento', 'a pagamento', 'costoso', '課金', '有料', '高すぎ', 'サブスク', '値上げ'],
  ads: ['werbung', 'werbeanzeigen', 'anzeigen', 'pub', 'pubs', 'publicité', 'publicités', 'anuncios', 'publicidad', 'anúncios', 'propaganda', 'propagandas', 'pubblicità', '広告'],
  sync: ['synchronisiert', 'synchronisierung', 'synchronisation', 'synchronisieren', 'daten verloren', 'daten weg', 'synchroniser', 'données perdues', 'perdu toutes', 'sincroniza', 'sincronización', 'perdí todo', 'perdí mis', 'sincronização', 'perdi tudo', 'perdi meus', 'sincronizza', 'sincronizzazione', 'perso tutto', '同期', 'データが消え', 'バックアップ'],
  battery: ['akku', 'akkuverbrauch', 'batterie', 'batería', 'bateria', 'batteria', 'バッテリー', '電池'],
  ui: ['neues design', 'neue design', 'unübersichtlich', 'altes design', 'alte version', 'nouvelle interface', 'nouveau design', 'ancienne version', 'nuevo diseño', 'versión anterior', 'confuso', 'novo design', 'versão antiga', 'nuova interfaccia', 'vecchia versione', 'デザイン', '使いにくい', '使いづらい', '前の方が'],
  missing: ['fehlt', 'wünsche mir', 'wäre schön', 'wäre toll', 'bitte hinzufügen', 'manque', 'il manque', 'ce serait bien', 'serait bien', 'falta', 'sería genial', 'ojalá', 'seria ótimo', 'manca', 'sarebbe bello', '欲しい', 'ほしい', '追加して', '対応して'],
  performance: ['langsam', 'ruckelt', 'lädt ewig', 'ladezeit', 'ladezeiten', 'lent', 'lente', 'lenteur', 'rame', 'lento', 'lenta', 'tarda mucho', 'demora', 'lentissima', '重い', '遅い', 'もっさり'],
  'update-bug': ['seit dem update', 'seit dem letzten update', 'nach dem update', 'seit update', 'funktioniert nicht mehr', 'geht nicht mehr', 'depuis la mise à jour', 'depuis la dernière mise à jour', 'ne fonctionne plus', 'ne marche plus', 'desde la actualización', 'después de actualizar', 'ya no funciona', 'dejó de funcionar', 'depois da atualização', 'após a atualização', 'não funciona mais', 'parou de funcionar', 'dopo l’aggiornamento', 'non funziona più', 'アップデートしてから', 'アップデート後', 'アプデ後', '使えなくなっ'],
}

const STOP = new Set(('a an and are as at be been but by can could did do does dont doesnt for from get got had has have having he her his how i if im in into is it its ive just me more most my no not now of on once only or other our out over own same she should so some still such than that the their them then there these they this those to too very was way we were what when where which while who why will with would you your app apps really even also all any one get use using used much like ill youre theyre cant wont isnt wasnt didnt thing things every lot lots make made new time ever back give gave since okay ok sometimes star stars review update version please thanks thank good great love bad ' +
  'about after again am because before being both cannot couldnt down during each few here him himself hers id let lets may might must off onto ourselves shall shouldnt up upon us were whom yet yours youve wouldnt havent hasnt arent werent thats theres whats going go goes went want wants wanted need needs needed keep keeps try tried trying know say says said see seem seems think thought already always never nothing something anything everything though although until without within lol pls plz im ' +
  // German, French, Spanish, Portuguese and Italian function words, so clusters in those storefronts show the complaint, not the grammar.
  'der die das den dem des ein eine einen einem einer und oder aber ist sind war ich du er sie es wir ihr mir mich dir dich mein meine nicht kein keine auch nur noch schon sehr mit von für fur auf aus bei nach zu zum zur im am um als wie wenn dass daß man hat habe haben kann wird werden wurde mehr immer wieder diese dieser dieses einfach leider bitte danke mal so da hier jetzt seit über uber durch vor ohne bis was wer wo weil doch sich mich ' +
  'le la les un une des du de et ou mais est sont était je tu il elle nous vous ils elles mon ma mes ce cette ces ne pas plus très tres avec pour sur dans par en au aux que qui quoi dont où si tout tous toute toutes bien fait faire être avoir ai as avez ont suis cest jai nest sans depuis encore aussi comme on se sa son ses leur leurs merci trop peu ' +
  'el los las uno una unos unas y o pero es son era yo tú tu él ella nosotros mi mis su sus no muy con para por en al del que quien como cuando si todo todos toda todas más mas ya hay tiene tengo hace hacer está esta están este esto estos estas sin desde también tambien porque me te se lo le les gracias ' +
  'os um uma uns umas e ou mas é são eu ele ela nós meu minha seu sua não nao muito com para por em no na nos nas ao aos do da dos das que quem como quando se tudo todos toda mais já ja tem tenho faz fazer está estão este esta isso isto sem desde também tambem porque obrigado obrigada pra pro ' +
  'il lo gli uno i e o ma è sono ero io lui lei noi voi loro mio mia suo sua non molto con per su tra fra nel nella nei nelle al allo alla ai agli alle dal dalla che chi come quando se tutto tutti tutta più piu già gia ha ho hanno fa fare questo questa questi queste senza da anche perché perche mi ti si ci vi grazie').split(' '))

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/

/** Lowercase words. Letters of every script are kept, so "stürzt" and "français" stay whole. */
const words = (text: string) => text.toLowerCase().replace(/[’'`´]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)

/** The words worth clustering by: no single letters and no bare numbers. */
export const tokenize = (text: string): string[] => words(text).filter(w => w.length > 1 && !/^\d+$/.test(w))

const norm = (s: string) => ' ' + words(s).join(' ') + ' '
const kwCache = new Map<string, string>()
const kw = (k: string) => { let v = kwCache.get(k); if (v === undefined) { v = norm(k); kwCache.set(k, v) } return v }

const keywordsOf = (rule: ThemeRule) => rule.builtin && INTL[rule.id] ? [...rule.keywords, ...INTL[rule.id]] : rule.keywords
/** Whole-word match for spaced scripts; plain substring for Japanese, Chinese and Korean phrases. */
const hit = (k: string, t: string, raw: string) => CJK.test(k) ? raw.includes(k.toLowerCase()) : !!kw(k).trim() && t.includes(kw(k))

/** Theme ids that match a review (title + body), in rule order. */
export function classify(r: Pick<Review, 'title' | 'body'>, rules: ThemeRule[]): string[] {
  const raw = `${r.title} ${r.body}`.toLowerCase(), t = norm(raw)
  return rules.filter(x => x.enabled && keywordsOf(x).some(k => hit(k, t, raw))).map(x => x.id)
}

/** Which keywords matched, for explaining a classification in the UI. */
export function matchedKeywords(r: Pick<Review, 'title' | 'body'>, rule: ThemeRule): string[] {
  const raw = `${r.title} ${r.body}`.toLowerCase(), t = norm(raw)
  return keywordsOf(rule).filter(k => hit(k, t, raw))
}

export interface ThemeStat {
  id: string
  label: string
  n: number
  share: number
  mean: number
  /** Mean rating of reviews without the theme minus mean with it: how many stars the theme costs. */
  impact: number
  examples: Review[]
}

export function themeStats(reviews: Review[], rules: ThemeRule[]): ThemeStat[] {
  const tagged = reviews.map(r => ({ r, t: classify(r, rules) }))
  return rules.filter(x => x.enabled).map(rule => {
    const inT = tagged.filter(x => x.t.includes(rule.id)).map(x => x.r)
    const outT = tagged.filter(x => !x.t.includes(rule.id)).map(x => x.r)
    const m = avg(inT.map(r => r.rating)), mo = avg(outT.map(r => r.rating))
    return {
      id: rule.id, label: rule.label, n: inT.length, share: reviews.length ? inT.length / reviews.length : 0,
      mean: m, impact: inT.length && outT.length ? mo - m : 0,
      examples: [...inT].sort((a, b) => a.rating - b.rating || b.body.length - a.body.length).slice(0, 3),
    }
  }).filter(s => s.n > 0).sort((a, b) => b.n - a.n)
}

const avg = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0

export interface Emerging { id: string; label: string; latest: number; before: number; lift: number; n: number }

/**
 * Themes whose share in the latest version is well above their share across earlier versions.
 * Requires at least 3 mentions and a 1.5x lift (or new from zero), and enough earlier reviews (MIN_N) to have a share to compare with.
 */
export function emergingThemes(reviews: Review[], rules: ThemeRule[], latest: string): Emerging[] {
  const now = reviews.filter(r => r.version === latest)
  const prev = reviews.filter(r => r.version !== latest && cmpVersion(r.version, latest) < 0)
  if (!now.length || prev.length < MIN_N) return []
  const share = (rs: Review[], id: string) => rs.length ? rs.filter(r => classify(r, rules).includes(id)).length / rs.length : 0
  return rules.filter(x => x.enabled).map(rule => {
    const n = now.filter(r => classify(r, rules).includes(rule.id)).length
    const latestShare = n / now.length, before = share(prev, rule.id)
    return { id: rule.id, label: rule.label, latest: latestShare, before, lift: before ? latestShare / before : latestShare ? Infinity : 0, n }
  }).filter(e => e.n >= 3 && e.latest - e.before >= 0.05 && (e.before === 0 || e.lift >= 1.5)).sort((a, b) => (b.latest - b.before) - (a.latest - a.before))
}

// ---------- TF-IDF term clusters ----------

/** Unigrams and bigrams after stopword removal. */
export function terms(text: string, extra?: Set<string>): string[] {
  const w = tokenize(text).filter(x => !STOP.has(x) && !extra?.has(x))
  const out = [...w]
  for (let i = 0; i + 1 < w.length; i++) out.push(`${w[i]} ${w[i + 1]}`)
  return out
}

export interface Cluster { terms: string[]; n: number; mean: number; reviews: Review[] }

/**
 * Greedy clustering: score terms by TF-IDF summed over low-rated reviews, then group reviews
 * by their highest-scoring term. Terms already covered by an earlier cluster are skipped, and
 * each cluster label adds the strongest co-occurring terms.
 */
export function clusters(reviews: Review[], k = 8, maxRating = 3, appName = ''): Cluster[] {
  // The app's own name is in half the reviews and says nothing about the complaint.
  const own = new Set(tokenize(appName))
  const docs = reviews.map(r => ({ r, t: new Set(terms(`${r.title} ${r.body}`, own)) }))
  const N = docs.length
  if (!N) return []
  const df = new Map<string, number>()
  for (const d of docs) for (const t of d.t) df.set(t, (df.get(t) ?? 0) + 1)
  const score = new Map<string, number>()
  for (const d of docs) {
    if (d.r.rating > maxRating) continue
    for (const t of d.t) {
      const f = df.get(t)!
      if (f < 2) continue
      // Bigrams carry more meaning per mention.
      score.set(t, (score.get(t) ?? 0) + Math.log(N / f) * (t.includes(' ') ? 1.6 : 1))
    }
  }
  const ranked = [...score].sort((a, b) => b[1] - a[1]).map(x => x[0])
  const used = new Set<Review>()
  const out: Cluster[] = []
  for (const t of ranked) {
    if (out.length >= k) break
    const members = docs.filter(d => d.t.has(t) && !used.has(d.r) && d.r.rating <= maxRating)
    if (members.length < 2) continue
    members.forEach(d => used.add(d.r))
    const co = new Map<string, number>()
    for (const d of members) for (const x of d.t) if (x !== t && !t.includes(x) && !x.includes(t)) co.set(x, (co.get(x) ?? 0) + 1)
    const extra = [...co].filter(x => x[1] >= Math.max(2, members.length * 0.3)).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0])
    out.push({ terms: [t, ...extra], n: members.length, mean: avg(members.map(d => d.r.rating)), reviews: members.map(d => d.r) })
  }
  return out
}

// ---------- Feature requests ----------

const REQ = /\b(?:please (?:add|bring back|make|let|allow|give|consider)|i wish|wish (?:it|there|you|they)|would (?:be|love) (?:great|nice|awesome|amazing|cool|helpful) if|would love (?:to see|it if|a|an)|it would be (?:great|nice|awesome|helpful)|feature request|can you (?:please )?add|could you (?:please )?add|needs? (?:an? |the )?option|should (?:have|add)|hoping for|bring back)\b[^.!?\n]*/i

export interface Request { text: string; review: Review }

/** Sentences that ask for something, from any rating. */
export function featureRequests(reviews: Review[]): Request[] {
  const out: Request[] = []
  for (const r of reviews) {
    for (const s of `${r.title}. ${r.body}`.split(/(?<=[.!?\n])\s+/)) {
      const m = s.match(REQ)
      if (m) { out.push({ text: s.slice(m.index).trim().replace(/^\W+/, '').slice(0, 220), review: r }); break }
    }
  }
  return out
}

const REQ_WORDS = new Set('add added adding wish wished option options feature features request bring hoping hope great nice awesome amazing cool helpful able love see would could should consider allow let give make made way there something maybe also really'.split(' '))

/** Groups requests by their most shared term (bigrams preferred) so "dark mode" asked ten ways shows once. */
export function groupRequests(reqs: Request[]): { topic: string; n: number; examples: Request[] }[] {
  const by = new Map<string, Request[]>()
  const df = new Map<string, number>()
  const ts = reqs.map(q => [...new Set(terms(q.text, REQ_WORDS))])
  for (const t of ts) for (const x of t) df.set(x, (df.get(x) ?? 0) + 1)
  const weight = (t: string) => (df.get(t) ?? 0) * (t.includes(' ') ? 1.5 : 1)
  reqs.forEach((q, i) => {
    const best = [...ts[i]].sort((a, b) => weight(b) - weight(a))[0]
    const topic = best && (df.get(best) ?? 0) >= 2 ? best : 'other'
    by.set(topic, [...(by.get(topic) ?? []), q])
  })
  return [...by].map(([topic, l]) => {
    const seen = new Set<string>()
    const examples = l.filter(x => { const k = x.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 4)
    return { topic, n: l.length, examples }
  }).sort((a, b) => (a.topic === 'other' ? 1 : 0) - (b.topic === 'other' ? 1 : 0) || b.n - a.n)
}

// ---------- What to fix next ----------

export interface FixItem { id: string; label: string; n: number; impact: number; score: number; trend: number; why: string }

/** Ranked by mentions x stars lost, boosted when the theme is growing in the latest version. */
export function whatToFix(reviews: Review[], rules: ThemeRule[], latest: string | null): FixItem[] {
  const stats = themeStats(reviews, rules)
  const emerging = latest ? emergingThemes(reviews, rules, latest) : []
  return stats.filter(s => s.impact > 0 && s.id !== 'missing').map(s => {
    const e = emerging.find(x => x.id === s.id)
    const trend = e ? e.latest - e.before : 0
    const score = s.n * s.impact * (1 + trend * 4)
    const why = `${s.n} reviews, ${s.impact.toFixed(1)} stars below the rest${e ? `, up ${Math.round(trend * 100)} points in ${latest}` : ''}`
    return { id: s.id, label: s.label, n: s.n, impact: s.impact, score, trend, why }
  }).sort((a, b) => b.score - a.score)
}

const FIXED: Record<string, string> = {
  crash: 'Fixed a crash some people saw when opening the app',
  login: 'Fixed an issue that could sign you out or block sign-in',
  paywall: 'Made plans and pricing clearer, and kept the core features free',
  ads: 'Reduced how often ads appear',
  sync: 'Improved sync reliability so your data stays up to date on every device',
  battery: 'Reduced battery use in the background',
  ui: 'Refined the new design based on your feedback',
  performance: 'Faster loading and smoother scrolling',
  'update-bug': 'Fixed issues introduced in the last update',
}

/** "Fixed: ..." lines for the themes the user marks as addressed. `countries` are those the complaints came from; a single one is named. */
export function releaseNotes(items: { id: string; label: string }[], countries: string[] = []): string {
  const lines = items.map(i => `• ${FIXED[i.id] ?? `Fixed: ${i.label.toLowerCase()} issues reported in reviews`}`)
  if (!lines.length) return ''
  const where = countries.length === 1 ? ` in ${countries[0].toUpperCase()}` : ''
  return `What's new\n\n${lines.join('\n')}\n\nThank you for every review${where}. We read them all.`
}
