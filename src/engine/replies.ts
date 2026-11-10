// Developer response drafts. Responses are posted in App Store Connect (Ratings and Reviews),
// or through the App Store Connect API customerReviewResponses endpoint. Assumptions checked November 2026:
// - Limit: 5,970 characters per response; one response per review, editable later.
// - Responses are public and appear under the review; the reviewer is notified and may update their review.
// - Apple's guidance: be specific, courteous, do not include personal data, and do not ask for a better rating
//   in exchange for anything.
import type { Review } from './types.ts'

export const RESPONSE_LIMIT = 5970
export const RESPONSE_RULES_DATE = 'November 2026'

export interface ReplyContext { appName: string; developer: string; supportEmail: string; signature: string; fixedIn?: string }

const T: Record<string, (c: ReplyContext, r: Review) => string> = {
  crash: (c, r) => `Thank you for reporting this, and sorry ${c.appName} crashed on you${r.version !== 'unknown' ? ` in version ${r.version}` : ''}. ${c.fixedIn ? `We fixed the cause in version ${c.fixedIn}. Please update and let us know if it still happens.` : 'We are working on a fix now.'} If you can, email ${c.supportEmail} with your device model and iOS version so we can confirm it is the same issue.`,
  login: c => `Sorry you had trouble signing in. ${c.fixedIn ? `Version ${c.fixedIn} fixes the sign-in problem some people saw.` : 'We are looking into it.'} Your data is safe on our side. If you are still locked out, email ${c.supportEmail} from the address on your account and we will get you back in.`,
  paywall: c => `Thank you for the honest feedback about pricing. We know the change was not what you expected. The core features remain free, and Premium pays for the work on new features. If you were charged by mistake, you can request a refund at reportaproblem.apple.com, and we are happy to help at ${c.supportEmail}.`,
  ads: c => `Thanks for telling us about the ads. ${c.fixedIn ? `In version ${c.fixedIn} we show them less often.` : 'We are reviewing how often they appear.'} If you would rather not see any, Premium removes them entirely.`,
  sync: c => `We are sorry about the sync trouble; losing data is the last thing we want. ${c.fixedIn ? `Version ${c.fixedIn} improves sync reliability.` : 'We are investigating now.'} Please email ${c.supportEmail} before reinstalling, as we may be able to restore your data from the last good sync.`,
  battery: c => `Thanks for flagging the battery use. ${c.fixedIn ? `Version ${c.fixedIn} reduces background activity.` : 'We are profiling background activity to bring it down.'} If it continues, a note to ${c.supportEmail} with your device model helps us reproduce it.`,
  ui: c => `Thank you for the feedback on the new design. We changed it to make room for upcoming features, but we hear you that some things are harder to find now. ${c.fixedIn ? `Version ${c.fixedIn} brings back quicker access to the parts you use most.` : 'We are adjusting it in the next update.'}`,
  missing: c => `Thank you for the suggestion. We keep a list of requests and this one is on it. Feel free to send more detail to ${c.supportEmail}; it really does shape what we build next.`,
  performance: c => `Sorry the app felt slow. ${c.fixedIn ? `Version ${c.fixedIn} speeds up loading.` : 'We are working on performance in the next update.'} If a specific screen is slow, let us know at ${c.supportEmail}.`,
  'update-bug': c => `Sorry the last update broke things for you. ${c.fixedIn ? `Version ${c.fixedIn} fixes the issues we introduced.` : 'We are working on a fix and will ship it as soon as it is ready.'} Thank you for your patience, and for telling us.`,
  positive: c => `Thank you so much for the kind words! Reviews like yours keep a small team like ours going. If you ever have an idea for ${c.appName}, we would love to hear it at ${c.supportEmail}.`,
  generic: c => `Thank you for taking the time to write this. We read every review. If you can share more detail at ${c.supportEmail}, we will look into it and get back to you.`,
}

/** Picks the template for the review's first theme, or a positive/generic one. */
export function draftReply(r: Review, themes: string[], c: ReplyContext): { theme: string; text: string } {
  const theme = themes.find(t => T[t]) ?? (r.rating >= 4 ? 'positive' : 'generic')
  const body = T[theme](c, r)
  const text = `${body}\n\n${c.signature || `The ${c.appName} team`}`
  return { theme, text: text.length > RESPONSE_LIMIT ? text.slice(0, RESPONSE_LIMIT) : text }
}

/** Flags drafts that break the guidance: too long, a leftover placeholder, or asking for a better rating. */
export function checkReply(text: string): string[] {
  const issues: string[] = []
  if (text.length > RESPONSE_LIMIT) issues.push(`Over the ${RESPONSE_LIMIT.toLocaleString()} character limit`)
  if (/\{|\}|\[name\]|TODO/i.test(text)) issues.push('Contains a placeholder')
  if (/(change|update|raise|bump|increase).{0,25}(rating|review|stars)|5 stars/i.test(text)) issues.push('Asks for a better rating, which Apple discourages')
  if (/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(text)) issues.push('Looks like it contains a phone number')
  return issues
}
