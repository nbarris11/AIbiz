const revealElements = document.querySelectorAll(".reveal");

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }
  },
  {
    threshold: 0.18,
    rootMargin: "0px 0px -48px 0px",
  },
);

for (const element of revealElements) {
  observer.observe(element);
}

const contactForm = document.querySelector("#contact-form");
const formStatus = document.querySelector("#form-status");

if (contactForm && formStatus) {
  contactForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!contactForm.reportValidity()) {
      formStatus.textContent = "Please fill in the required fields so we know how to help.";
      formStatus.className = "form-status is-error";
      return;
    }

    const formData = new FormData(contactForm);
    const name = String(formData.get("name") || "").trim();
    const business = String(formData.get("business") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const businessType = String(formData.get("business_type") || "").trim();
    const timeline = String(formData.get("timeline") || "").trim();
    const message = String(formData.get("message") || "").trim();

    const subject = `Discovery Inquiry from ${business}`;
    const body = [
      `Name: ${name}`,
      `Business: ${business}`,
      `Email: ${email}`,
      `Phone: ${phone || "Not provided"}`,
      `Business Type: ${businessType}`,
      `Timeline: ${timeline}`,
      "",
      "What they need help with:",
      message,
    ].join("\n");

    formStatus.textContent =
      "Opening your email app with your inquiry pre-filled. Replace the destination email before launch if needed.";
    formStatus.className = "form-status is-success";

    window.location.href = `mailto:hello@detroitaiconsultingco.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });
}
