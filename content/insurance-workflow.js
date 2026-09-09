(() => {
  const demo = document.querySelector('[data-workflow-demo]');
  if (!demo) return;
  demo.classList.add('is-interactive');
  const steps = [
    ['Quote recorded', 'The producer records that a quote was sent and chooses an owner and next-action date.'],
    ['Follow-up due', 'The chosen date arrives. Q-104 is still open, so the owner receives a task. A missing owner or a paused record goes to review instead.'],
    ['Staff review', 'The owner checks the record and edits or approves the reminder. This example does not send anything. Coverage questions stay with agency staff.'],
    ['Reply received', 'The prospect replies. Follow-up stops and the owner handles the conversation. If the system cannot detect replies, the owner updates the status manually.'],
  ];
  const title = demo.querySelector('[data-demo-title]');
  const copy = demo.querySelector('[data-demo-copy]');
  const next = demo.querySelector('[data-demo-next]');
  const reset = demo.querySelector('[data-demo-reset]');
  const markers = demo.querySelectorAll('[data-demo-step]');
  let current = 0;
  function render() {
    title.textContent = steps[current][0];
    copy.textContent = steps[current][1];
    markers.forEach((marker, index) => {
      if (index === current) marker.setAttribute('aria-current', 'step');
      else marker.removeAttribute('aria-current');
    });
    next.textContent = current === steps.length - 1 ? 'See the example again' : 'Show next step';
  }
  next.addEventListener('click', () => { current = (current + 1) % steps.length; render(); });
  reset.addEventListener('click', () => { current = 0; render(); });
  render();
})();
