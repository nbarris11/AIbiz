const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db.js');

const router = express.Router();

const LOGO_FILE = path.join(__dirname, '../assets/logo.png');
const LOGO_MIME = 'image/png';

// GET /t/:trackingId
// Public (no auth) — called by email clients when they render the signature logo.
// Serves the logo image and records the first open.
router.get('/:trackingId', (req, res) => {
  const { trackingId } = req.params;

  // Log open (best-effort — never fail the image response)
  try {
    const activity = db.prepare(
      'SELECT id, opened_at, open_count FROM activities WHERE tracking_id = ?'
    ).get(trackingId);

    if (activity) {
      if (!activity.opened_at) {
        db.prepare(
          'UPDATE activities SET opened_at = ?, open_count = 1 WHERE id = ?'
        ).run(new Date().toISOString(), activity.id);
      } else {
        db.prepare(
          'UPDATE activities SET open_count = open_count + 1 WHERE id = ?'
        ).run(activity.id);
      }
    }
  } catch (err) {
    console.warn('[track-open]', err && err.message);
  }

  // Serve the logo
  if (fs.existsSync(LOGO_FILE)) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', LOGO_MIME);
    fs.createReadStream(LOGO_FILE).pipe(res);
  } else {
    // Fallback: 1×1 transparent GIF if logo file missing
    const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'image/gif');
    res.end(pixel);
  }
});

module.exports = router;
