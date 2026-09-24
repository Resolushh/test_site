'use strict';
// Google Tag устанавливается отдельно в head каждой HTML-страницы.
const leadForm = document.querySelector('#lead-form');
if (leadForm) {
  leadForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (typeof gtag === 'function') {
      gtag('event', 'generate_lead', {
        lead_source: 'contact_form'
      });
    }
    document.querySelector('#form-status').textContent =
      'Учебная форма проверена. Данные не отправлены.';
  });
}

const programCta = document.querySelector('#program-cta');
if (programCta) {
  programCta.addEventListener('click', () => {
    document.querySelector('#program-preview').hidden = false;
    if (typeof gtag === 'function') {
      gtag('event', 'cta_click', {
        button_name: 'program',
        page_section: 'hero'
      });
    }
  });
}

document.querySelectorAll('nav a').forEach((link) => {
  link.addEventListener('click', () => {
    gtag('event', 'nav_click', {
      link_text: link.textContent.trim(),
      from_page: document.title
    });
  });
});

const params = new URLSearchParams(window.location.search);
const utmSource = params.get('utm_source');
if (utmSource) {
  gtag('event', 'utm_visit', {
    utm_source: utmSource,
    utm_medium: params.get('utm_medium') || 'not_set',
    utm_campaign: params.get('utm_campaign') || 'not_set',
    landing_page: window.location.pathname
  });
}

let readCounted = false;
setTimeout(() => {
  if (readCounted || document.hidden) return;
  readCounted = true;
  gtag('event', 'read_30s', {
    page_path: window.location.pathname
  });
}, 30000);

const leadFormFields = document.querySelector('#lead-form');
if (leadFormFields) {
  leadFormFields.addEventListener('invalid', (event) => {
    gtag('event', 'form_error', {
      field_name: event.target.name || 'unknown',
      form_id: 'lead-form'
    });
  }, true);
}

programCta.addEventListener('click', () => {
  gtag('event', 'cta_click', {
    button_name: 'program', page_section: 'hero'
  });
});