const header = document.querySelector(".site-header");
const revealItems = document.querySelectorAll(".reveal");
const heroSection = document.querySelector("#hero");
const mobileCtaBar = document.querySelector("#mobile-cta-bar");

if (header) {
  const syncHeaderState = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 12);
  };

  syncHeaderState();
  window.addEventListener("scroll", syncHeaderState, { passive: true });
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
