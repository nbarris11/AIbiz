const header = document.querySelector(".site-header");
const navToggle = document.querySelector(".nav-toggle");
const primaryNav = document.querySelector("#primary-nav");
const revealItems = document.querySelectorAll(".reveal");
const heroSection = document.querySelector("#hero");
const mobileCtaBar = document.querySelector("#mobile-cta-bar");
const siteContent = window.SIDECAR_SITE_CONTENT || {};

function getContentValue(path) {
  return path.split(".").reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    if (/^\d+$/.test(key)) return value[Number(key)];
    return value[key];
  }, siteContent);
}

function applySiteContent() {
  const contentNodes = document.querySelectorAll("[data-content]");

  for (const node of contentNodes) {
    const value = getContentValue(node.dataset.content);
    if (value === undefined || value === null) continue;

    if ("contentAttrText" in node.dataset) {
      node.textContent = String(value);
      continue;
    }

    if (node.dataset.contentAttr) {
      node.setAttribute(node.dataset.contentAttr, String(value));
      continue;
    }

    node.textContent = String(value);
  }

  const linkNodes = document.querySelectorAll("[data-link-content]");
  for (const node of linkNodes) {
    const value = getContentValue(node.dataset.linkContent);
    if (value) node.setAttribute("href", String(value));
  }

  const aboutImage = document.querySelector("[data-about-image]");
  const aboutPlaceholder = document.querySelector("[data-about-placeholder]");
  if (aboutImage && aboutPlaceholder) {
    const imageUrl = getContentValue(aboutImage.dataset.content);
    const imageAlt = getContentValue(aboutImage.dataset.altContent || "");

    if (imageAlt) {
      aboutImage.alt = String(imageAlt);
    }

    if (imageUrl) {
      aboutImage.src = String(imageUrl);
      aboutImage.hidden = false;
      aboutPlaceholder.classList.add("has-image");
    } else {
      aboutImage.removeAttribute("src");
      aboutImage.hidden = true;
      aboutPlaceholder.classList.remove("has-image");
    }
  }

  const popularPills = document.querySelectorAll(".popular-pill");
  for (const pill of popularPills) {
    pill.hidden = !pill.textContent.trim();
  }
}

applySiteContent();

// Use the existing analytics integration. Never send form contents or contact
// details; analytics failure must not interrupt navigation or submissions.
window.sidecarTrack = (name, properties = {}) => {
  if (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) return;
  try {
    window.posthog?.capture(name, { page_path: window.location.pathname, ...properties });
  } catch (_) { /* Analytics is optional. */ }
};

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  const url = new URL(link.href, window.location.href);
  const placement = link.closest('section')?.id || (link.closest('nav') ? 'navigation' : 'page');
  if (url.hostname === 'calendly.com' || url.hash === '#schedule') {
    window.sidecarTrack('booking_cta_clicked', { placement });
  } else if (url.pathname === '/contact/' && url.origin === window.location.origin) {
    window.sidecarTrack('contact_cta_clicked', { placement });
  }
});

// Count a booking only when the embedded calendar reports a scheduled event.
// A CTA click alone is not a completed booking.
let bookingRecorded = false;
window.addEventListener('message', (event) => {
  const calendar = document.querySelector('#schedule iframe');
  if (!calendar || event.origin !== 'https://calendly.com' || event.source !== calendar.contentWindow) return;
  if (event.data?.event === 'calendly.event_scheduled' && !bookingRecorded) {
    bookingRecorded = true;
    window.sidecarTrack('booking_completed', { placement: 'embedded_calendar' });
  }
});

if (header) {
  const syncHeaderState = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  };

  syncHeaderState();
  window.addEventListener("scroll", syncHeaderState, { passive: true });
}

if (navToggle && primaryNav) {
  navToggle.addEventListener("click", () => {
    const isOpen = primaryNav.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth >= 768) {
      primaryNav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  });
}

if (revealItems.length > 0 && 'IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    {
      threshold: 0.16,
      rootMargin: "0px 0px -40px 0px",
    },
  );

  for (const item of revealItems) {
    item.classList.add('reveal-ready');
    revealObserver.observe(item);
  }
}

if (heroSection && mobileCtaBar && 'IntersectionObserver' in window) {
  const syncMobileCtaState = (entries) => {
    const shouldShow = window.innerWidth < 768 && entries[0] && !entries[0].isIntersecting;
    mobileCtaBar.classList.toggle("is-visible", shouldShow);
    mobileCtaBar.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  };

  const mobileCtaObserver = new IntersectionObserver(syncMobileCtaState, {
    threshold: 0.15,
  });

  mobileCtaObserver.observe(heroSection);

  window.addEventListener("resize", () => {
    if (window.innerWidth >= 768) {
      mobileCtaBar.classList.remove("is-visible");
      mobileCtaBar.setAttribute("aria-hidden", "true");
    }
  });
}
