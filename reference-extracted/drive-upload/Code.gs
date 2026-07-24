/**
 * EPROM Weekly/Monthly Progress Report — Google Drive upload endpoint
 * Deploy: Extensions → Apps Script → paste this → Deploy → New deployment
 *   Type: Web app · Execute as: Me · Who has access: Anyone with the link
 * Then copy the Web app URL into the report's Tweaks → "Upload endpoint URL".
 */

// ==== CONFIG ====
var ROOT_FOLDER_ID = 'PASTE_YOUR_DRIVE_FOLDER_ID_HERE'; // drive.google.com/drive/folders/<THIS PART>
var ADMIN_PIN = '2468';                                  // must match the PIN in the report Tweaks
// ================

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (String(body.pin) !== ADMIN_PIN) return json_({ ok: false, error: 'Wrong PIN' });

    var root = DriveApp.getFolderById(ROOT_FOLDER_ID);
    // Folder layout: <root>/<Project Name>/<2026>/
    var projFolder = getOrCreate_(root, String(body.project || 'Untitled Project'));
    var yearFolder = getOrCreate_(projFolder, String(body.year || new Date().getFullYear()));

    // File: EP-SU-PSAIM-WPR-29 — 2026-W29.pdf (or .html/.json)
    var name = String(body.filename || 'report');
    var blob;
    if (body.pdfBase64) {
      blob = Utilities.newBlob(Utilities.base64Decode(body.pdfBase64), 'application/pdf', name + '.pdf');
    } else if (body.html) {
      blob = Utilities.newBlob(body.html, 'text/html', name + '.html');
    } else {
      blob = Utilities.newBlob(JSON.stringify(body.data || {}, null, 2), 'application/json', name + '.json');
    }

    // Overwrite same-name file (new revision) instead of duplicating
    var existing = yearFolder.getFilesByName(blob.getName());
    while (existing.hasNext()) existing.next().setTrashed(true);
    var file = yearFolder.createFile(blob);

    // Optional attachments: [{name, base64, mime}]
    if (body.attachments && body.attachments.length) {
      var attFolder = getOrCreate_(yearFolder, name + ' — attachments');
      body.attachments.forEach(function (a) {
        attFolder.createFile(Utilities.newBlob(Utilities.base64Decode(a.base64), a.mime || 'application/octet-stream', a.name));
      });
    }

    return json_({ ok: true, fileUrl: file.getUrl(), folderUrl: yearFolder.getUrl() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// Health check: open the web-app URL in a browser
function doGet() { return json_({ ok: true, service: 'EPROM report upload', time: new Date().toISOString() }); }

function getOrCreate_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
