# Connect the reports to Google Drive (one-time, ~5 minutes)

1. **Create / pick the Drive folder** that will hold all reports.
   Copy its ID from the URL: `drive.google.com/drive/folders/`**`1AbC…xyz`**

2. **Open [script.google.com](https://script.google.com) → New project**, delete the default code, paste `Code.gs`.

3. Edit the two config lines at the top:
   - `ROOT_FOLDER_ID` → your folder ID
   - `ADMIN_PIN` → same PIN as in the report Tweaks (default `2468`)

4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone with the link**
   - Click Deploy, authorize, and **copy the Web app URL** (`https://script.google.com/macros/s/…/exec`)

5. In the Weekly/Monthly report, open **Tweaks** and paste:
   - **Upload endpoint URL** → the Web app URL
   - **Drive folder URL** → `https://drive.google.com/drive/folders/<your folder ID>` (feeds the QR code)

Done. "Approve & Upload" now saves a real file to
`<folder>/<Project Name>/<Year>/<Report No.>.html` — same-name uploads replace the old file (revision behavior). The QR on the printed sheet opens the archive folder.

**Notes**
- Uploads are sent as self-contained HTML snapshots (open in any browser, print to PDF from there).
- If you later change the PIN, change it in BOTH the Tweaks and `Code.gs`.
- To test the endpoint: open the Web app URL in a browser — you should see `{"ok":true,…}`.
