export interface Review {
  /** Stable id: the App Store review id when known, otherwise a hash of the content. */
  id: string
  appId: string
  country: string
  rating: number
  version: string
  title: string
  body: string
  author: string
  /** ISO timestamp. */
  date: string
  source: 'rss' | 'import' | 'sample'
}

export interface AppInfo {
  id: string
  name: string
  developer: string
  icon: string
  genre: string
  version: string
  releaseNotes: string
  currentVersionReleaseDate: string
  rating: number | null
  ratingCount: number | null
  currentVersionRating: number | null
  currentVersionRatingCount: number | null
  url: string
}

export interface VersionInfo {
  version: string
  /** ISO date (YYYY-MM-DD) of release or first review seen. */
  date: string
  notes?: string
  /** 'listed' came from a version list or the lookup API; 'inferred' from the first review on that version. */
  origin: 'listed' | 'inferred'
}

export interface ThemeRule {
  id: string
  label: string
  /** Lowercase phrases; a review matches if any phrase appears as a whole word sequence. */
  keywords: string[]
  /** Built-in rules can be edited or disabled but are restored from defaults. */
  builtin?: boolean
  enabled: boolean
}
