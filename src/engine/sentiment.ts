// Lexicon sentiment, a secondary signal next to the star rating.
// The word list below is written for this project (MIT, same as the repo). It follows the
// AFINN approach (Nielsen 2011: integer valence from -5 to +5, summed and normalised) but
// no entries are copied from AFINN, whose own list is distributed under the ODbL.

const L: Record<string, number> = {}
const add = (score: number, words: string) => { for (const w of words.split(' ')) L[w] = score }
add(5, 'amazing awesome brilliant excellent fantastic flawless incredible outstanding perfect superb wonderful')
add(4, 'beautiful delightful favorite favourite gorgeous lifesaver love loved loving masterpiece')
add(3, 'best enjoy enjoyed fabulous fun great happy helpful impressed intuitive lovely recommend recommended smooth solid')
add(2, 'clean cool easy effective elegant fast glad good handy improved improvement neat nice pleased quick reliable simple stable thanks thank useful well worth works')
add(1, 'decent fine fixed ok okay polished responsive')
add(-1, 'annoying bit confusing meh odd slow wait weird unclear')
add(-2, 'bug buggy clunky complicated disappointed disappointing doesnt fails failed failing glitch glitchy lag laggy lost missing problem problems sad slower sluggish stuck tedious unstable wrong')
add(-3, 'awful bad broke broken crash crashed crashes crashing frustrating frustrated greedy hate hated horrible junk pointless poor ripoff scam stupid terrible ugly unusable useless waste worse')
add(-4, 'abysmal disgusting garbage pathetic rubbish trash worst')
add(-5, 'fraud')

const NEG = new Set(['not', 'no', 'never', 'dont', 'doesnt', 'didnt', 'isnt', 'wasnt', 'cant', 'wont', 'hardly', 'without'])

/**
 * Sum of word scores, with a negator within the two previous words flipping the sign
 * ("not great" counts as negative). Returns the sum and a -1..1 comparative score.
 */
export function sentiment(text: string): { score: number; comparative: number; hits: string[] } {
  const w = text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean)
  let score = 0
  const hits: string[] = []
  w.forEach((x, i) => {
    const v = L[x]
    if (!v) return
    const flip = NEG.has(w[i - 1]) || NEG.has(w[i - 2])
    score += flip ? -v : v
    hits.push(flip ? `not ${x}` : x)
  })
  // Normalise by the square root of length so long reviews do not dominate, then clamp.
  const comparative = w.length ? Math.max(-1, Math.min(1, score / (5 * Math.sqrt(w.length)))) : 0
  return { score, comparative, hits }
}

/** Reviews whose text disagrees with their stars: 4-5 stars with clearly negative text, or 1-2 with positive. */
export const mismatch = (rating: number, comparative: number) => (rating >= 4 && comparative <= -0.25) || (rating <= 2 && comparative >= 0.25)
