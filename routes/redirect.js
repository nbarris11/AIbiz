const express = require('express');
const db = require('../db');
const router = express.Router();

// GET /r/:clickId — public, no auth
// Marks first click, then 302 redirects to the stored destination URL.
router.get('/:clickId', (req, res) => {
  const row = db.prepare('SELECT * FROM link_clicks WHERE id = ?').get(req.params.clickId);
  if (!row) {
    return res.redirect('https://sidecaradvisory.com');
  }
  // Record first click only
  if (!row.clicked_at) {
    try {
      db.prepare("UPDATE link_clicks SET clicked_at = datetime('now') WHERE id = ?")
        .run(req.params.clickId);
    } catch (err) {
      console.warn('[redirect] click update failed:', err && err.message);
    }
  }
  res.redirect(302, row.url);
});

module.exports = router;
