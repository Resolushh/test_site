'use strict';
// js/script.js — отправка формы заявок в Apps Script Web App (doPost).
// Согласован с серверным контрактом:
//   обязательные поля: request_id, name, email, direction
//   request_id: REQ-<UUID v4 в верхнем регистре>
//   direction ∈ {frontend, backend, data}
//   ответ: {ok:true, request_id} | {ok:false, error, [fields]}
(() => {
  const leadForm = document.querySelector('#lead-form');
  if (!leadForm) return;

  const statusEl = document.querySelector('#form-status');
  const submitBtn = leadForm.querySelector('[type="submit"]');
  const requestIdEl = leadForm.elements.namedItem('request_id');

  // Без request_id и status-элемента вся логика бессмысленна.
  if (!requestIdEl || !statusEl) return;

  const params = new URLSearchParams(window.location.search);
  const DEFAULTS = { utm_source: 'direct', utm_medium: 'none', utm_campaign: 'not_set' };

  const setField = (name, value) => {
    const el = leadForm.elements.namedItem(name);
    if (el) el.value = value;
  };
  const applyUtmDefaults = () => {
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
      setField(key, params.get(key)?.trim() || fallback);
    }
  };

  applyUtmDefaults();

  // --- Генерация REQ-<UUID v4> в верхнем регистре ---------------------------
  // crypto.randomUUID() доступен только в secure context (https / localhost).
  // Fallback собирает UUID v4 вручную из getRandomValues (или Math.random,
  // если и его нет). Формат обязан совпадать с серверной регуляркой.
  function makeRequestId() {
    let hex;
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      hex = crypto.randomUUID();
    } else {
      const bytes = new Uint8Array(16);
      if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      // RFC 4122: version 4, variant 10xx
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const h = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
      hex = `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    }
    return 'REQ-' + hex.toUpperCase();
  }

  // --- Проверка URL веб-приложения -----------------------------------------
  // На прод пускаем только /exec (не /dev). Совпадает с проверкой в HTML.
  const ENDPOINT_RE = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/;
  function getEndpoint() {
    return (leadForm.action || '').trim();
  }

  // --- Клиентская валидация (зеркало серверной) ----------------------------
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const ALLOWED_DIRECTIONS = ['frontend', 'backend', 'data'];
  const MAX_LEN_FIELDS = ['name', 'email', 'utm_source', 'utm_medium', 'utm_campaign'];

  function validate(values) {
    const missing = ['request_id', 'name', 'email', 'direction'].filter(k => !String(values[k] || '').trim());
    if (missing.length) return { error: 'missing_required', fields: missing };
    if (!/^REQ-[A-F0-9]{8}-[A-F0-9]{4}-4[A-F0-9]{3}-[89AB][A-F0-9]{3}-[A-F0-9]{12}$/i.test(values.request_id)) {
      return { error: 'invalid_request_id' };
    }
    if (!EMAIL_RE.test(values.email)) return { error: 'invalid_email' };
    if (!ALLOWED_DIRECTIONS.includes(values.direction)) return { error: 'invalid_direction' };
    if (MAX_LEN_FIELDS.some(k => String(values[k] || '').trim().length > 200)) {
      return { error: 'value_too_long' };
    }
    return null;
  }

  // --- Человекочитаемые сообщения об ошибках сервера -----------------------
  const ERROR_MESSAGES = {
    missing_required:      'Заполните обязательные поля.',
    invalid_request_id:    'Некорректный идентификатор заявки. Обновите страницу и попробуйте снова.',
    invalid_email:         'Проверьте адрес электронной почты.',
    invalid_direction:     'Выберите направление из списка.',
    value_too_long:        'Одно из полей слишком длинное.',
    duplicate_request_id:  'Эта заявка уже отправлена. Нажмите «Сбросить», чтобы создать новую.',
    busy_retry:            'Сервер занят, попробуйте ещё раз через пару секунд.',
    invalid_sheet_schema:  'Ошибка на стороне сервера. Сообщите администратору.',
    storage_error:         'Не удалось сохранить заявку. Попробуйте позже.'
  };
  const messageFor = error => ERROR_MESSAGES[error] || 'Не удалось отправить заявку.';

  // --- Сбор значений формы в объект ----------------------------------------
  function collect() {
    const fd = new FormData(leadForm);
    const values = {};
    for (const [k, v] of fd.entries()) values[k] = typeof v === 'string' ? v.trim() : v;
    return values;
  }

  function setBusy(busy) {
    if (submitBtn) submitBtn.disabled = busy;
    leadForm.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  // --- Отправка -------------------------------------------------------------
  let inFlight = false;

  leadForm.addEventListener('submit', async event => {
    event.preventDefault(); // всегда: отправляем через fetch, не уходим со страницы
    if (inFlight) return;

    const endpoint = getEndpoint();
    if (!ENDPOINT_RE.test(endpoint)) {
      statusEl.textContent = 'Сначала укажите URL опубликованного Apps Script Web App (/exec).';
      return;
    }

    // ID переиспользуется при повторной отправке без reset — так сервер
    // отсекает дубликаты (duplicate_request_id).
    if (!requestIdEl.value) requestIdEl.value = makeRequestId();

    const values = collect();
    const clientError = validate(values);
    if (clientError) {
      statusEl.textContent = messageFor(clientError.error);
      return;
    }

    // GA4: фиксируем попытку. generate_lead уйдёт только после ok:true.
    if (typeof window.gtag === 'function') {
      window.gtag('event', 'lead_submit_attempt', { lead_source: 'contact_form' });
    }

    inFlight = true;
    setBusy(true);
    statusEl.textContent = 'Отправляем…';

    try {
      // text/plain;charset=utf-8 — единственный Content-Type, при котором
      // Apps Script не ломается на CORS-preflight для простого запроса.
      const response = await fetch(endpoint, {
        method: 'POST',
        mode: 'cors',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: new URLSearchParams(values).toString()
      });

      // Apps Script всегда отвечает 200; реальный статус — в теле JSON.
      let data = null;
      try { data = await response.json(); } catch (_) { /* не JSON */ }

      if (!data || typeof data !== 'object') {
        statusEl.textContent = 'Некорректный ответ сервера. Попробуйте позже.';
        return;
      }

      if (data.ok) {
        statusEl.textContent = 'Заявка отправлена. Номер: ' + data.request_id;
        if (typeof window.gtag === 'function') {
          window.gtag('event', 'generate_lead', {
            lead_source: 'contact_form',
            request_id: data.request_id
          });
        }
        leadForm.reset(); // reset-хендлер сгенерирует новый ID при следующей отправке
      } else {
        statusEl.textContent = messageFor(data.error);
      }
    } catch (err) {
      statusEl.textContent = 'Сеть недоступна. Проверьте соединение и попробуйте ещё раз.';
    } finally {
      inFlight = false;
      setBusy(false);
    }
  });

  // --- Сброс -----------------------------------------------------------------
  // reset срабатывает до фактической очистки полей, поэтому значения
  // возвращаем в следующем микротаске.
  leadForm.addEventListener('reset', () => {
    queueMicrotask(() => {
      requestIdEl.value = '';
      applyUtmDefaults();
      statusEl.textContent = 'Можно заполнить новую заявку.';
    });
  });
})();

// CTA из существующего сайта темы 6 — без изменений.
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
