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

  const popularPill = document.querySelector(".popular-pill");
  if (popularPill && !popularPill.textContent.trim()) {
    popularPill.hidden = true;
  }
}

applySiteContent();

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

if (revealItems.length > 0) {
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
    revealObserver.observe(item);
  }
}

if (heroSection && mobileCtaBar) {
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
