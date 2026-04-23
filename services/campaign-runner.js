const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { sendEmail, isWithinBusinessHours, renderMergeFields } = require('./email');

function findDueEnrollments() {
  return db.prepare(`
    SELECT
      e.id as enrollment_id, e.campaign_id, e.contact_id, e.current_step,
      e.enrolled_at, e.last_step_sent_at,
      s.template_id, s.subject_override, s.delay_days, s.step_number,
      (SELECT COUNT(*) FROM campaign_steps WHERE campaign_id = e.campaign_id) as total_steps
    FROM campaign_enrollments e
    JOIN campaign_steps s ON s.campaign_id = e.campaign_id AND s.step_number = e.current_step
    WHERE e.status = 'active'
      AND datetime(
        COALESCE(e.last_step_sent_at, e.enrolled_at),
        '+' || (s.delay_days * 24) || ' hours'
      ) <= datetime('now')
  `).all();
}

async function runCampaignSweep() {
  if (!isWithinBusinessHours()) return { skipped: 'outside business hours', sent: 0 };

  const due = findDueEnrollments();
  if (!due.length) return { sent: 0, total_due: 0 };

  let sent = 0;
  const failed = [];

  for (const row of due) {
    try {
      const enrollment = db.prepare('SELECT status FROM campaign_enrollments WHERE id = ?').get(row.enrollment_id);
      if (!enrollment || enrollment.status !== 'active') continue;

      const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(row.contact_id);
      if (!contact || !contact.email) continue;

      const template = db.prepare('SELECT * FROM email_templates WHERE id = ?').get(row.template_id);
      if (!template) continue;

      const subject = renderMergeFields(row.subject_override || template.subject, contact);
      const body = renderMergeFields(template.body, contact);

      await sendEmail({
        to: contact.email,
        subject,
        body,
        contactId: contact.id,
        campaignId: row.campaign_id,
        stepNumber: row.step_number,
      });

      const isLastStep = row.current_step >= row.total_steps;
      db.prepare(`
        UPDATE campaign_enrollments
        SET last_step_sent_at = datetime('now'),
            current_step = ?,
            status = ?
        WHERE id = ?
      `).run(
        isLastStep ? row.current_step : row.current_step + 1,
        isLastStep ? 'completed' : 'active',
        row.enrollment_id
      );

      sent++;
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      failed.push({ enrollmentId: row.enrollment_id, error: err.message });
      console.warn('[campaign-runner] step send failed:', err.message);
    }
  }

  if (sent > 0) console.log(`[campaign-runner] Sent ${sent} campaign step(s); ${failed.length} failed`);
  return { sent, failed, total_due: due.length };
}

function stopEnrollmentsForContact(contactId, reason) {
  const stopStatuses = ['Booked', 'Bounced', 'Unsubscribed', 'Replied — Interested', 'Replied — Not Now', 'Replied — Not Interested'];
  const contact = db.prepare('SELECT reply_status FROM contacts WHERE id = ?').get(contactId);
  if (!contact) return;
  if (!stopStatuses.includes(contact.reply_status) && reason !== 'replied') return;

  db.prepare(`
    UPDATE campaign_enrollments SET status = ?
    WHERE contact_id = ? AND status = 'active'
  `).run(reason === 'replied' ? 'replied' : 'stopped', contactId);
}

function startCampaignRunner() {
  setInterval(() => {
    runCampaignSweep().catch(err => console.error('[campaign-runner] sweep error:', err.message));
  }, 15 * 60 * 1000);
  console.log('[campaign-runner] Started — sweeps every 15 min during business hours');
}

module.exports = { startCampaignRunner, runCampaignSweep, stopEnrollmentsForContact };
