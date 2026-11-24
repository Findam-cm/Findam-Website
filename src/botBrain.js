// Findam Bot: picks the best answer by scoring each topic against the question.
// Kept separate from the UI so it can be tested with many real questions.
import { REFERRAL_PROGRAMME } from './referral.js'

const n = new Intl.NumberFormat('en-US')

// Each topic: words/phrases (strong ones score 3, normal 1) and the reply.
// Phrases are matched on word boundaries, in English and common French.
const TOPICS = [
  {
    id: 'greeting',
    strong: [/^(hi|hello|hey|hiya|good (morning|afternoon|evening)|bonjour|bonsoir|salut|yo)\b[!. ]*$/],
    words: [],
    reply: () => 'Hello! I can help you find a home, unlock a landlord’s contact, list a property or refer a landlord. What would you like to do?',
  },
  {
    id: 'thanks',
    strong: [/^(thanks?|thank you|merci|ok(ay)?|great|cool)\b[!. ]*$/],
    words: [],
    reply: () => 'You’re welcome! Ask me anything else about Findam.',
  },
  {
    id: 'expiry',
    strong: [/expir/, /locked again/, /lock(s|ed)? again/, /after 24/, /pass (ended|ends|finished|over)/, /how long/, /(pass|access) last/],
    words: [],
    reply: (c) => `A pass lasts ${c.hours} hours from the moment your payment is approved. You can see the time left at the top of the page and on each listing. When it ends, contacts and exact locations lock again; buy a new pass to unlock them.`,
  },
  {
    id: 'pass',
    strong: [/access pass/, /\bpass\b/, /\bunlock/, /subscri/, /abonnement/, /d[ée]bloqu/, /24 ?h(ours?)?\b/, /\block(ed)?\b/, /(how much|cost|price|pay).*(contact|number|unlock|location|landlord)/, /(contact|number|location).*(cost|pay|price|how much)/, /cost to (see|get|unlock|call)/],
    words: [/\bfee\b/],
    reply: (c) => `An access pass costs ${n.format(c.fee)} FCFA and shows the landlord’s phone number and the exact location of every home on Findam for ${c.hours} hours. Open any listing, press “Unlock”, choose MTN Mobile Money or Orange Money and approve on your phone. After ${c.hours} hours, details lock again and you can buy a new pass.`,
  },
  {
    id: 'payment_problem',
    strong: [/no prompt/, /didn.?t (get|receive)/, /not (get|receive)/, /money (was )?(taken|deducted|gone)/, /deducted/, /charged/, /refund/, /rembours/, /payment (failed|not working|declined)/, /didn.?t work/],
    words: [/failed/, /declin/, /problem/, /error/],
    reply: () => 'If no request appears on your phone, open your Mobile Money menu (MTN: *126#, Orange: #150#) and approve the pending payment; the page updates by itself. If the payment failed, check your balance and try again. If money left your account but the page is still locked, wait a minute and refresh; if it stays locked, contact the Findam team with the time and the number you paid from.',
  },
  {
    id: 'payment_methods',
    strong: [/mobile money/, /\bmomo\b/, /\bmtn\b/, /\borange\b(?! colou?r)/, /how (do|can) i pay/, /payment method/, /paiement/, /\bpayer\b/, /mesomb/],
    words: [/\bpay(ing|ment)?\b/, /\bcard\b/, /\bcash\b/],
    reply: () => 'Payments on Findam use MTN Mobile Money or Orange Money, processed securely by MeSomb. You choose your network, enter your number, and approve the request on your phone with your PIN. Findam never sees your PIN. Cards and cash are not accepted on the site.',
  },
  {
    id: 'contact',
    strong: [/contact/, /phone number/, /landlord.?s? (number|phone)/, /call (the )?(landlord|owner|agent)/, /num[ée]ro/, /reach the (landlord|owner)/],
    words: [/\bagent\b/, /\bowner\b/, /whatsapp/],
    reply: (c) => `Each landlord’s phone number is shown on the listing once you have an access pass (${n.format(c.fee)} FCFA for ${c.hours} hours, all homes). Sign in, open the home, press “Unlock”, and the number appears with a “Call now” button.`,
  },
  {
    id: 'visit',
    strong: [/\bvisit/, /viewing/, /inspect/, /see the (house|home|room|place)/, /arrange/],
    words: [],
    reply: () => 'To visit a home, unlock its contact with an access pass and call the landlord to agree a time. The exact location and directions from where you are appear on the listing too.',
  },
  {
    id: 'location',
    strong: [/exact location/, /where (is|are) (it|the house|the home|this)/, /directions?/, /how (do|can) i get there/, /\bgps\b/, /itin[ée]raire/, /adresse/, /\baddress\b/, /\bmap\b/, /\blocation\b/],
    words: [/\bwhere\b/],
    reply: () => 'Every listing shows its neighbourhood and city. With an access pass you also see the house on a map (street or satellite) with an exact pin, and “Directions from my location” draws the route from where you are. On the search page, “See location on map” shows the area you searched.',
  },
  {
    id: 'referral',
    strong: [/refer/, /r[ée]f[ée]r/, /commission/, /\breward/, /recompense/, /r[ée]compense/, /programme/, /program\b/],
    words: [/\bearn\b/, /\bgain\b/, /make money/, /bonus/, /credit/],
    reply: () => `${REFERRAL_PROGRAMME.name}: refer a landlord on the “Refer a landlord” page. Findam contacts and verifies them and lists their homes. When Findam has visited and confirmed one of their homes, the landlord pays your referral reward with Mobile Money and Findam sends it straight to your MTN or Orange number.${REFERRAL_PROGRAMME.reward ? ` ${REFERRAL_PROGRAMME.reward}` : ''}`,
  },
  {
    id: 'list_property',
    strong: [/list (my|a|your)? ?(house|home|property|room|apartment|flat|studio)/, /list a property/, /(post|advertise|add|upload|put) (my|a) (house|home|property|room|listing)/, /i (am|m) a landlord/, /i have (a|an|some) (house|room|apartment|property|studio)s? (to|for) (rent|let|sell)/, /mettre en location/],
    words: [/\blandlord\b/, /\blist\b/, /\bsell my\b/],
    reply: () => 'To list a property: sign in, open “List a property”, add the title, city, neighbourhood, the full price in FCFA, bedrooms, a description, your phone number and up to 6 photos, then submit. An admin reviews it before it goes public, and you can mark it as taken from your account once it is rented or sold.',
  },
  {
    id: 'photos',
    strong: [/photo/, /picture/, /\bimages?\b/, /\bpics?\b/],
    words: [],
    reply: () => 'You can upload up to 6 photos per home. They are shown whole, exactly as taken, upright or sideways, and very large photos are shrunk automatically so they load fast on mobile data. Visitors can tap a photo to see it full screen.',
  },
  {
    id: 'prices',
    strong: [/how much (is|are|does) (the )?(rent|a room|a house|a studio|an apartment|a flat)/, /\bprices?\b/, /\bbudget\b/, /\bcheap/, /afford/, /\bfcfa\b/, /per (month|year|night)/, /\bloyer\b/, /\bprix\b/, /expensive/],
    words: [/how much/, /\bcost\b/],
    reply: () => 'Prices are full amounts in FCFA: rent is shown per month or per year, guest houses per night, and homes for sale show the full price. In search, type your budget in full (for example 150000 for 150,000 FCFA) and choose per month or per year.',
  },
  {
    id: 'alerts',
    strong: [/notif/, /\balerts?\b/, /tell me when/, /let me know when/, /new (homes|listings)/],
    words: [],
    reply: () => 'Search for the kind of home you want, then press “Notify me of new matches”. New matching homes appear on the bell at the top of the page, and as a pop-up on your phone or computer if you allow notifications.',
  },
  {
    id: 'taken',
    strong: [/\btaken\b/, /still available/, /is it available/, /already (rented|sold)/, /unavailable/, /no longer available/],
    words: [/\bavailable\b/],
    reply: () => 'Homes that have been rented or sold are marked Taken and hidden from search, so the homes you see can still be rented or bought. If a home you saved becomes taken, its contact closes.',
  },
  {
    id: 'verification',
    strong: [/verif/, /\bsafe\b/, /\bscam/, /\btrust/, /genuine/, /\breal\b/, /\bfake\b/, /arnaque/],
    words: [/\bsample\b/],
    reply: () => 'Every listing stays off the public site until a Findam admin has checked and accepted it, and Findam can visit and confirm homes. Homes marked “Sample” are examples, not real homes. Never pay a deposit before you have seen the home.',
  },
  {
    id: 'guest_house',
    strong: [/guest ?house/, /short (stay|let)/, /\bper night\b/, /\bweekend\b/, /furnished/, /\bhotel\b/],
    words: [],
    reply: () => 'Guest houses are furnished short stays, priced per night. Choose “Guest house” in the search filters to see them.',
  },
  {
    id: 'cities',
    strong: [/\bcit(y|ies)\b/, /\btowns?\b/, /which (areas|places)/, /where do you (work|operate)/, /\bdouala\b/, /\blimbe\b/, /\bkumba\b/],
    words: [/\bbamenda\b/, /\bbuea\b/, /\byaound[ée]\b/],
    reply: (c, q) => (/douala|limbe|kumba/.test(q)
      ? 'Findam does not cover that town yet. Today we list homes in Bamenda, Buea and Yaounde; more cities are coming.'
      : 'Findam lists homes in Bamenda, Buea and Yaounde. Pick a city in the search, or open “Homes in Bamenda”, “Homes in Buea” or “Homes in Yaounde” at the bottom of any page.'),
  },
  {
    id: 'sale',
    strong: [/for sale/, /\bbuy (a|an)? ?(house|home|land|property)/, /purchase/, /\bacheter\b/, /\bland\b/],
    words: [/\bbuy\b/],
    reply: () => 'Homes for sale show their full sale price in FCFA. Choose “Sale” in the property type filter, or open “Homes for sale” at the bottom of any page.',
  },
  {
    id: 'account',
    strong: [/sign ?up/, /register/, /create (an )?account/, /sign ?in/, /log ?in/, /password/, /mot de passe/, /\baccount\b/, /inscri/],
    words: [],
    reply: (c, q) => (/password|mot de passe|forgot/.test(q)
      ? 'On the Account page choose “Sign in”, then “Forgot your password?”. Enter your email and we send you a link to choose a new password.'
      : 'Press “Sign up” at the top of the page. Enter your name, email and a password of at least 8 characters (you can press “Show” to check it), and your account is ready in under a minute.'),
  },
  {
    id: 'saved',
    strong: [/\bsaved?\b/, /favou?rite/, /\bheart\b/, /shortlist/],
    words: [],
    reply: () => 'Tap the heart on any home to save it. Your saved homes are on the “Saved” page at the top of the site.',
  },
  {
    id: 'search',
    strong: [/\bsearch/, /\bfilter/, /looking for/, /\bfind (a|an|me)\b/, /bedrooms?/, /\bchambre/, /\bmaison\b/, /\bstudio\b/, /apartment|appartement/, /\bhostel/, /self.?contain/],
    words: [/\broom\b/, /\bhouse\b/, /\bhome\b/, /\bflat\b/, /\brent\b/],
    reply: () => 'Open “Property listings” and filter by city, type, bedrooms and your budget (per month or per year). Results show first; press “See location on map” for the area, and “Notify me of new matches” to be told when a new home is published.',
  },
]

const FALLBACK = 'I can help with finding a home, prices, the access pass, payments with MTN or Orange Money, exact locations, listing a property, alerts and the referral programme. Could you ask in a few more words?'

export function answer(question, context = {}) {
  const c = { fee: context.fee || 1000, hours: context.hours || 24 }
  const q = String(question || '').toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim()
  if (!q) return { id: 'empty', text: FALLBACK }
  let best = null
  TOPICS.forEach((topic, index) => {
    const score = topic.strong.filter((re) => re.test(q)).length * 3 + topic.words.filter((re) => re.test(q)).length
    if (score > 0 && (!best || score > best.score || (score === best.score && index < best.index))) best = { topic, score, index }
  })
  if (!best) return { id: 'fallback', text: FALLBACK }
  return { id: best.topic.id, text: best.topic.reply(c, q) }
}
