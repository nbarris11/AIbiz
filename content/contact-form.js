(() => {
  const email = window.SIDECAR_SITE_CONTENT?.settings?.email || 'hello@sidecaradvisory.com';
  const form = document.querySelector('#contact-form');
  if (!form) return;
  const status = document.querySelector('#contact-form-status');
  const success = document.querySelector('#contact-success-card');
  const button = document.querySelector('#contact-submit-button');
  const track = (name) => window.sidecarTrack?.(name, { form: 'contact' });
  const reason = new URLSearchParams(window.location.search).get('reason');
  if (reason === 'workflow') form.elements.reason.value = 'Workflow help';
  form.addEventListener('focusin', () => track('contact_form_started'), { once: true });
  let sending = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    const values = new FormData(form);
    if (String(values.get('_honey') || '').trim()) return;
    const payload = {};
    for (const key of ['name', 'email', 'company', 'business_type', 'reason', 'message']) {
      payload[key] = String(values.get(key) || '').trim();
    }
    if (!payload.name || !payload.email || !payload.message) {
      status.textContent = 'Please add your name, email, and a short message.';
      status.classList.add('is-error');
      return;
    }
    Object.assign(payload, {
      _subject: 'New Sidecar Advisory contact form submission',
      _captcha: 'false', _template: 'table',
      source_page: window.location.origin + window.location.pathname,
    });
    sending = true;
    button.disabled = true;
    button.textContent = 'Sending…';
    status.classList.remove('is-error');
    status.textContent = 'Submitting…';
    track('contact_form_submitted');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload), signal: controller.signal,
      });
      if (!response.ok) throw new Error('HTTP failure');
      const result = await response.json();
      if (result.success !== true && result.success !== 'true') throw new Error('Not accepted');
      form.reset();
      form.hidden = true;
      success.classList.add('is-visible');
      status.textContent = '';
      document.querySelector('#contact-success-title')?.focus();
      track('contact_form_accepted');
    } catch (error) {
      status.textContent = error.name === 'AbortError'
        ? `We could not confirm your submission. Your message is still here. Please email ${email} if you are unsure whether it went through.`
        : `Your submission was not confirmed. Please try again or email ${email} directly.`;
      status.classList.add('is-error');
      track('contact_form_error');
    } finally {
      clearTimeout(timeout);
      sending = false;
      button.disabled = false;
      button.textContent = 'Send Message';
    }
  });
})();
