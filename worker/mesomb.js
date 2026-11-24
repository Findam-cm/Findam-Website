// MeSomb (Hachther) mobile-money API client for Cloudflare Workers.
// Mirrors the official SDK @hachther/mesomb v3 (AOperation, PaymentOperation, WebCryptoSigner,
// canonical.js) so requests are signed exactly as MeSomb expects, without Node-only dependencies.
//
// Secrets (set with `wrangler secret put`): MESOMB_APPLICATION_KEY, MESOMB_ACCESS_KEY, MESOMB_SECRET_KEY.
// Optional: MESOMB_HOST (only for local testing against a mock server).

const API_VERSION = 'v1.1'
const ALGORITHM = 'HMAC-SHA1'
const SDK_VERSION = '1.1.0'
const encoder = new TextEncoder()

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha1Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-1', encoder.encode(text)))
}

async function hmacSha1Hex(text, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(text)))
}

export function makeNonce(length = 40) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

// Same algorithm as the SDK's WebCryptoSigner + canonical.js.
export async function signRequest({ service = 'payment', method, url, date, nonce, accessKey, secretKey, headers = {}, body }) {
  const parsed = new URL(url)
  const timestamp = date.getTime()
  const all = { ...headers }
  const canonicalQuery = parsed.search ? parsed.search.substring(1) : ''
  all.host = `${parsed.protocol}//${parsed.host}`
  all['x-mesomb-date'] = String(timestamp)
  all['x-mesomb-nonce'] = nonce
  const keys = Object.keys(all).sort()
  const canonicalHeaders = keys.map((key) => `${key}:${all[key]}`).join('\n')
  const signedHeaders = keys.join(';')
  const path = encodeURI(parsed.pathname)
  const scope = `${date.getFullYear()}${date.getMonth()}${date.getDate()}/${service}/mesomb_request`
  const payloadHash = await sha1Hex(body ? JSON.stringify(body) : '{}')
  const canonicalRequest = `${method}\n${path}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
  const stringToSign = `${ALGORITHM}\n${timestamp}\n${scope}\n${await sha1Hex(canonicalRequest)}`
  const signature = await hmacSha1Hex(stringToSign, secretKey)
  return `${ALGORITHM} Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

export function mesombConfigured(env) {
  return Boolean(env.MESOMB_APPLICATION_KEY && env.MESOMB_ACCESS_KEY && env.MESOMB_SECRET_KEY)
}

function host(env) {
  return String(env.MESOMB_HOST || 'https://mesomb.hachther.com').replace(/\/$/, '')
}

// Same request as the SDK's AOperation.executeRequest. Returns { ok, status, data } or { ok:false, status, error, code }.
export async function mesombRequest(env, method, endpoint, { body = null, mode = 'asynchronous', date = new Date(), nonce, fetchImpl = fetch, timeoutMs = 150000 } = {}) {
  if (!mesombConfigured(env)) return { ok: false, status: 0, error: 'MeSomb is not connected yet.' }
  const url = `${host(env)}/api/${API_VERSION}/${endpoint}`
  const usedNonce = nonce ?? (method === 'GET' ? '' : makeNonce())
  const headers = {
    'x-mesomb-date': String(date.getTime()),
    'x-mesomb-nonce': usedNonce,
    'Content-Type': 'application/json',
    'X-MeSomb-OperationMode': mode,
    'X-MeSomb-Source': `MeSombJS/v${SDK_VERSION}`,
    'Accept-Language': 'en',
    'X-MeSomb-Application': env.MESOMB_APPLICATION_KEY,
  }
  const payload = body ? { ...body } : null
  if (payload?.trxID) {
    headers['X-MeSomb-TrxID'] = String(payload.trxID)
    delete payload.trxID
  }
  const credentials = { accessKey: env.MESOMB_ACCESS_KEY, secretKey: env.MESOMB_SECRET_KEY }
  headers.Authorization = method !== 'GET' && payload
    ? await signRequest({ method, url, date, nonce: usedNonce, ...credentials, headers: { 'content-type': 'application/json' }, body: payload })
    : await signRequest({ method, url, date, nonce: usedNonce, ...credentials, headers: {}, body: {} })
  let response
  try {
    response = await fetchImpl(url, { method, headers, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    return { ok: false, status: 0, error: error?.name === 'TimeoutError' ? 'MeSomb took too long to answer.' : 'MeSomb could not be reached.' }
  }
  if (response.status === 204) return { ok: true, status: 204, data: null }
  const text = await response.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch {}
  if (response.status >= 400) return { ok: false, status: response.status, error: data?.detail || text.slice(0, 200) || `MeSomb error ${response.status}`, code: data?.code }
  return { ok: true, status: response.status, data }
}

// Body field order matches PaymentOperation.makeCollect.
export function collect(env, { amount, service, payer, trxID, fees = true, mode = 'synchronous', customer, products }) {
  const body = { amount, service, payer, country: 'CM', currency: 'XAF', amount_currency: 'XAF', fees, conversion: false }
  if (trxID) body.trxID = trxID
  if (customer) body.customer = customer
  if (products) body.products = Array.isArray(products) ? products : [products]
  return mesombRequest(env, 'POST', 'payment/collect/', { body, mode })
}

// Body field order matches PaymentOperation.makeDeposit.
export function deposit(env, { amount, service, receiver, trxID, customer, products }) {
  const body = { amount, receiver, service, country: 'CM', currency: 'XAF', conversion: false, amount_currency: 'XAF' }
  if (trxID) body.trxID = trxID
  if (customer) body.customer = customer
  if (products) body.products = Array.isArray(products) ? products : [products]
  return mesombRequest(env, 'POST', 'payment/deposit/', { body })
}

// Look transactions up by our own transaction IDs (sent as X-MeSomb-TrxID), as PaymentOperation.checkTransactions.
export function checkTransactions(env, ids, source = 'EXTERNAL') {
  return mesombRequest(env, 'GET', `payment/transactions/check/?ids=${ids.join(',')}&source=${source}`)
}

export function applicationStatus(env) {
  return mesombRequest(env, 'GET', 'payment/status/')
}

// The status of a collect/deposit response ('SUCCESS' | 'FAILED' | 'PENDING'), however the response is shaped.
export function transactionStatus(data) {
  if (!data) return 'PENDING'
  const status = String(data.status || data.transaction?.status || '').toUpperCase()
  if (status === 'SUCCESS' || status === 'FAILED') return status
  if (data.success === false && !status) return 'FAILED'
  return 'PENDING'
}

// Cameroon numbers: keep the 9 local digits (6XXXXXXXX).
export function localNumber(phone) {
  let digits = String(phone || '').replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('237')) digits = digits.slice(3)
  if (digits.length === 13 && digits.startsWith('00237')) digits = digits.slice(5)
  return /^6\d{8}$/.test(digits) ? digits : null
}

// Best guess of the operator from the number prefix; the payer can always change it.
export function guessOperator(phone) {
  const n = localNumber(phone)
  if (!n) return null
  const p3 = Number(n.slice(0, 3))
  if (n.startsWith('67') || (p3 >= 650 && p3 <= 654) || (p3 >= 680 && p3 <= 683)) return 'MTN'
  if (n.startsWith('69') || (p3 >= 655 && p3 <= 659) || (p3 >= 686 && p3 <= 689)) return 'ORANGE'
  return null
}
