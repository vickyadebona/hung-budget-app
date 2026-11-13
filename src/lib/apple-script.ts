/**
 * The Google Apps Script each person pastes into script.google.com. It runs inside their own Google account,
 * finds Apple receipt emails, keeps only the part listing what was bought (never the billing address or card),
 * and posts it to the app every 6 hours.
 */
export function appleScript(appUrl: string, key: string): string {
  return `// Budget app: send Apple receipts from this Gmail to ${appUrl}
// Runs in your own Google account. It reads only emails from Apple's receipt address,
// and sends only the list of items and prices (not your address or payment card).

const APP_URL = ${JSON.stringify(appUrl)};
const KEY = ${JSON.stringify(key)}; // your personal key; keep it private

// Run this once. It asks for permission, sends the last 13 months of receipts,
// then sets itself to check for new ones every 6 hours.
function setup() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'sendAppleReceipts'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendAppleReceipts').timeBased().everyHours(6).create();
  sendAppleReceipts(400);
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
  for (var i = 0; i < receipts.length; i += 25) {
    var res = UrlFetchApp.fetch(APP_URL + '/api/apple/ingest', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-budget-key': KEY },
      payload: JSON.stringify({ receipts: receipts.slice(i, i + 25) }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('The budget app answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
    }
  }
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
