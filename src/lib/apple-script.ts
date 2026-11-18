import { env } from './auth';

/** The app's main address (not a one-off deployment link someone happened to open), for the script and emails. */
export function appUrl(fallback: string): string {
  for (const v of [env('APP_URL'), env('PLAID_REDIRECT_URI')]) {
    try {
      const u = new URL(v);
      if (u.protocol === 'https:') return u.origin;
    } catch { /* not set */ }
  }
  return fallback;
}

/**
 * The Google Apps Script each person pastes into script.google.com. It runs inside their own Google account,
 * finds Apple receipt emails and Link (Stripe's wallet) emails, keeps only the parts listing what was bought
 * (never the billing address, card or name), and posts them to the app every 6 hours.
 */
export function appleScript(appUrl: string, key: string): string {
  return `// Budget app: send Apple receipts and Link purchase emails from this Gmail to ${appUrl},
// and email you the app's alerts (bills due, 0% offers ending, price increases, large purchases) once a day.
// Runs in your own Google account. It reads only emails from Apple's receipt address and from Link
// (notifications@link.com), and sends only shop names, prices and dates (not your address, card or name).
// The alert email goes from you to you; nobody else receives it.

const APP_URL = ${JSON.stringify(appUrl)};
const KEY = ${JSON.stringify(key)}; // your personal key; keep it private

// Run this once (and again after pasting a new copy). It asks for permission, sends the last 13 months of
// emails, then checks for new ones every 6 hours and sends you the alert email each morning around 7.
function setup() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return ['sendAppleReceipts', 'sendAll', 'sendAlerts'].indexOf(t.getHandlerFunction()) >= 0; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendAll').timeBased().everyHours(6).create();
  ScriptApp.newTrigger('sendAlerts').timeBased().everyDays(1).atHour(7).create();
  sendAll(400);
}

// Asks the app what's new and, if there is anything, emails it to this Gmail address. Each alert is emailed once.
function sendAlerts() {
  var res = UrlFetchApp.fetch(APP_URL + '/api/alerts/digest', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-budget-key': KEY },
    payload: '{}',
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('The budget app answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }
  var mail = JSON.parse(res.getContentText()).email;
  if (!mail) { Logger.log('No new alerts'); return; }
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), mail.subject, mail.text, { name: 'Budget app' });
  Logger.log('Emailed ' + mail.count + ' alerts');
}

function sendAll(days) {
  days = typeof days === 'number' ? days : 3;
  sendAppleReceipts(days);
  sendLinkEmails(days);
}

function post(path, body) {
  var res = UrlFetchApp.fetch(APP_URL + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-budget-key': KEY },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('The budget app answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  }
}

// Link's monthly summaries, single-purchase emails and new-subscription emails. Sign-in alerts and offers are skipped.
function sendLinkEmails(days) {
  days = typeof days === 'number' ? days : 3;
  var query = 'from:notifications@link.com newer_than:' + days + 'd';
  var emails = [];
  for (var start = 0; ; start += 100) {
    var threads = GmailApp.search(query, start, 100);
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        if (!/notifications@link\\.com/i.test(m.getFrom())) return;
        var subject = m.getSubject();
        if (!/summary|activity|purchase|payment|subscription|receipt/i.test(subject)) return;
        emails.push({ id: m.getId(), date: m.getDate().toISOString(), subject: subject, text: linkText(m.getPlainBody() || m.getBody()) });
      });
    });
    if (threads.length < 100) break;
  }
  for (var i = 0; i < emails.length; i += 25) post('/api/link/ingest', { emails: emails.slice(i, i + 25) });
  Logger.log('Sent ' + emails.length + ' Link emails');
}

// Shop names, prices and dates only: links, email addresses, card numbers and the name/card lines are removed.
function linkText(text) {
  return text
    .replace(/<(style|script|head)[\\s\\S]*?<\\/\\1>/gi, ' ')
    .replace(/<br\\s*\\/?>|<\\/(p|div|tr|td)>/gi, '\\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\\(?https?:\\/\\/\\S+\\)?/g, ' ')
    .replace(/[^\\s@]+@[^\\s@]+\\.[a-z]{2,}/gi, ' ')
    .replace(/\\b(Payment|Declined|Account|Name|Card)\\s*\\n[^\\n]*/g, ' ')
    .replace(/[\\u2022\\u00b7*]{2,}\\s*\\d{2,4}/g, ' ')
    .replace(/\\((visa|mastercard|amex|discover)[^)]*\\)/gi, ' ')
    .replace(/[ \\t]+/g, ' ')
    .slice(0, 8000)
    .trim();
}

function sendAppleReceipts(days) {
  days = typeof days === 'number' ? days : 3;
  var query = 'from:no_reply@email.apple.com subject:receipt newer_than:' + days + 'd';
  var receipts = [];
  for (var start = 0; ; start += 100) {
    var threads = GmailApp.search(query, start, 100);
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (m) {
        if (!/no_reply@email\\.apple\\.com/i.test(m.getFrom())) return;
        receipts.push({ id: m.getId(), date: m.getDate().toISOString(), subject: m.getSubject(), text: itemsOnly(m.getBody()) });
      });
    });
    if (threads.length < 100) break;
  }
  for (var i = 0; i < receipts.length; i += 25) post('/api/apple/ingest', { receipts: receipts.slice(i, i + 25) });
  Logger.log('Sent ' + receipts.length + ' Apple receipts');
}

// Keep the item list only. Everything from "Billing and Payment" / "Subtotal" on is the address and card, so it is cut off.
function itemsOnly(html) {
  var t = html
    .replace(/<(style|script|head)[\\s\\S]*?<\\/\\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\\s+/g, ' ');
  var stop = t.search(/Billing and Payment|Subtotal|\\bTOTAL\\b|Payment Information/i);
  if (stop > 0) t = t.slice(0, stop);
  return t.replace(/[^\\s@]+@[^\\s@]+\\.[a-z]{2,}/gi, ' ').slice(0, 8000).trim();
}
`;
}
