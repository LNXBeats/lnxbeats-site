(() => {
  const form = document.querySelector('#custom-song-form');
  if (!form) return;
  const steps = [...form.querySelectorAll('.form-step')];
  const dots = [...document.querySelectorAll('.step-dot')];
  const progress = document.querySelector('.progress-bar span');
  const summary = document.querySelector('#order-summary');
  const paypalWrap = document.querySelector('#paypal-wrap');
  const bankWrap = document.querySelector('#bank-transfer-wrap');
  const payState = document.querySelector('#payment-state');
  const paymentMethodError = document.querySelector('#payment-method-error');
  let current = 0;
  let savedOrder = null;
  let apiConfig = null;
  let paypalLoaded = false;

  function showStep(i) {
    current = Math.max(0, Math.min(i, steps.length - 1));
    steps.forEach((s, idx) => s.hidden = idx !== current);
    dots.forEach((d, idx) => d.classList.toggle('active', idx <= current));
    progress.style.width = `${((current + 1) / steps.length) * 100}%`;
    window.scrollTo({ top: Math.max(0, form.offsetTop - 90), behavior: 'smooth' });
    if (current === steps.length - 1) renderSummary();
  }

  function validateStep() {
    const visible = steps[current];
    const required = [...visible.querySelectorAll('[required]')];
    for (const el of required) {
      if (!el.checkValidity()) { el.reportValidity(); return false; }
    }
    if (current === 2) {
      const choose = form.querySelector('#letLnxChoose').checked;
      const genre = form.querySelector('input[name="genre"]:checked');
      if (!choose && !genre) {
        document.querySelector('#genre-error').textContent = 'Choisis un style ou laisse LNX Beats choisir.';
        return false;
      }
      document.querySelector('#genre-error').textContent = '';
    }
    return true;
  }

  form.querySelectorAll('[data-next]').forEach(btn => btn.addEventListener('click', () => { if (validateStep()) showStep(current + 1); }));
  form.querySelectorAll('[data-prev]').forEach(btn => btn.addEventListener('click', () => showStep(current - 1)));

  const letChoose = form.querySelector('#letLnxChoose');
  const genreInputs = [...form.querySelectorAll('input[name="genre"]')];
  letChoose.addEventListener('change', () => {
    if (letChoose.checked) genreInputs.forEach(i => { i.checked = false; i.disabled = true; });
    else genreInputs.forEach(i => i.disabled = false);
  });
  genreInputs.forEach(i => i.addEventListener('change', () => { if (i.checked) letChoose.checked = false; }));

  const paymentInputs = [...form.querySelectorAll('input[name="paymentMethod"]')];
  paymentInputs.forEach(input => input.addEventListener('change', () => {
    paymentMethodError.textContent = '';
    paypalWrap.innerHTML = '';
    bankWrap.innerHTML = '';
    payState.textContent = input.value === 'paypal'
      ? 'PayPal sera chargé après enregistrement de la commande.'
      : 'Les coordonnées bancaires et la référence du virement seront affichées après enregistrement de la commande.';
  }));

  function values() {
    const fd = new FormData(form);
    const moods = [...form.querySelectorAll('input[name="mood"]:checked')].map(i => i.value);
    return {
      firstName: fd.get('firstName'), lastName: fd.get('lastName'), email: fd.get('email'), phone: fd.get('phone'),
      recipientType: fd.get('recipientType'), recipientName: fd.get('recipientName'), occasion: fd.get('occasion'), eventDate: fd.get('eventDate'),
      genre: letChoose.checked ? 'Choix LNX Beats' : fd.get('genre'), moods, voice: fd.get('voice'), story: fd.get('story'),
      paymentMethod: fd.get('paymentMethod')
    };
  }

  function esc(v='') { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function renderSummary() {
    const v = values();
    summary.innerHTML = `
      <div class="summary-row"><span>Commande</span><strong>Chanson personnalisée LNX Beats</strong></div>
      <div class="summary-row"><span>Client</span><strong>${esc(v.firstName)} ${esc(v.lastName)}</strong></div>
      <div class="summary-row"><span>Pour</span><strong>${esc(v.recipientName || v.recipientType || '—')}</strong></div>
      <div class="summary-row"><span>Style</span><strong>${esc(v.genre || '—')}</strong></div>
      <div class="summary-row"><span>Ambiance</span><strong>${esc(v.moods.join(', ') || 'Libre')}</strong></div>
      <div class="summary-row"><span>Livraison</span><strong>Sous 7 jours après paiement</strong></div>
      <div class="summary-row"><span>Réception</span><strong>${esc(v.email)}</strong></div>
      <div class="summary-row"><span>Droits inclus</span><strong>Personnel + réseaux non commerciaux</strong></div>
      <div class="summary-row"><span>Retouche</span><strong>1 modification raisonnable</strong></div>
      <div class="summary-total"><span>TOTAL</span><strong>50 €</strong></div>`;
  }

  async function saveOrder() {
    if (savedOrder) return savedOrder;
    const fd = new FormData(form);
    fd.set('letLnxChooseStyle', String(letChoose.checked));
    fd.set('moods', JSON.stringify([...form.querySelectorAll('input[name="mood"]:checked')].map(i => i.value)));
    fd.set('termsAccepted', String(form.querySelector('#termsAccepted').checked));
    fd.set('confirmAccuracy', String(form.querySelector('#confirmAccuracy').checked));
    fd.set('startBeforeWithdrawalEnd', String(form.querySelector('#startBeforeWithdrawalEnd').checked));
    fd.delete('mood');
    const response = await fetch('/api/orders', { method: 'POST', body: fd });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'Impossible d’enregistrer la commande.');
    savedOrder = json;
    paymentInputs.forEach(input => input.disabled = true);
    return json;
  }

  function loadPaypal(clientId) {
    if (paypalLoaded || window.paypal) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&intent=capture&components=buttons`;
      s.onload = () => { paypalLoaded = true; resolve(); };
      s.onerror = () => reject(new Error('Impossible de charger PayPal.'));
      document.head.appendChild(s);
    });
  }

  async function initPaypal(order) {
    if (!apiConfig.paypalReady) {
      payState.innerHTML = '<strong>PayPal n’est pas encore activé.</strong><br>Les identifiants API doivent être ajoutés dans la configuration sécurisée du site avant la mise en ligne.';
      return;
    }
    await loadPaypal(apiConfig.paypalClientId);
    paypalWrap.innerHTML = '';
    bankWrap.innerHTML = '';
    window.paypal.Buttons({
      style: { layout: 'vertical', shape: 'rect', label: 'pay' },
      createOrder: async () => {
        const r = await fetch('/api/paypal/create-order', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ orderId: order.id }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Erreur PayPal'); return j.paypalOrderId;
      },
      onApprove: async data => {
        payState.textContent = 'Validation du paiement…';
        const r = await fetch('/api/paypal/capture-order', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ orderId: order.id, paypalOrderId: data.orderID }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Paiement non confirmé.');
        const email = values().email;
        form.innerHTML = `<div class="success-panel"><div class="success-icon">✓</div><p class="eyebrow">PAIEMENT CONFIRMÉ</p><h2>Merci ! Ta commande est lancée.</h2><p>Commande <strong>${esc(j.id)}</strong> — 50 € payés via PayPal.</p><p>Livraison annoncée sous <strong>7 jours</strong> après confirmation du paiement et réception d’un brief exploitable.</p><p>La confirmation est envoyée à <strong>${esc(email)}</strong> dès que l’envoi e-mail du site est configuré.</p><a class="btn primary" href="/">Retour à l’accueil</a></div>`;
      },
      onError: err => { console.error(err); payState.textContent = 'Le paiement n’a pas pu être finalisé. Tu peux réessayer.'; }
    }).render('#paypal-wrap');
    payState.textContent = `Commande ${order.id} enregistrée. Finalise maintenant le paiement PayPal de 50 €.`;
  }

  async function initBankTransfer(order) {
    paypalWrap.innerHTML = '';
    bankWrap.innerHTML = '';
    if (!apiConfig.bankTransferReady) {
      payState.innerHTML = '<strong>Le virement bancaire est prévu, mais les coordonnées bancaires ne sont pas encore configurées.</strong><br>Renseigne le titulaire, l’IBAN et éventuellement le BIC dans la configuration sécurisée avant mise en ligne.';
      return;
    }
    const r = await fetch('/api/bank-transfer/instructions', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ orderId: order.id })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Impossible de préparer le virement.');
    const b = j.bank || {};
    bankWrap.innerHTML = `<div class="bank-instructions">
      <p class="eyebrow">VIREMENT BANCAIRE</p>
      <h3>Commande ${esc(j.id)}</h3>
      <div class="summary-row"><span>Montant</span><strong>50,00 €</strong></div>
      <div class="summary-row"><span>Titulaire</span><strong>${esc(b.accountHolder)}</strong></div>
      <div class="summary-row"><span>IBAN</span><strong class="bank-code">${esc(b.iban)}</strong></div>
      ${b.bic ? `<div class="summary-row"><span>BIC</span><strong class="bank-code">${esc(b.bic)}</strong></div>` : ''}
      ${b.bankName ? `<div class="summary-row"><span>Banque</span><strong>${esc(b.bankName)}</strong></div>` : ''}
      <div class="summary-row"><span>Référence obligatoire</span><strong>${esc(j.reference)}</strong></div>
      <p class="muted">La commande passera en création dès réception et validation du virement. Le délai de 7 jours démarre à ce moment-là.</p>
    </div>`;
    payState.textContent = `Commande ${order.id} enregistrée — en attente du virement de 50 €.`;
  }

  async function initPayment() {
    if (!form.querySelector('#termsAccepted').checked || !form.querySelector('#confirmAccuracy').checked) {
      payState.textContent = 'Merci de cocher les validations obligatoires.';
      return;
    }
    const paymentMethod = form.querySelector('input[name="paymentMethod"]:checked');
    if (!paymentMethod) {
      paymentMethodError.textContent = 'Choisis PayPal ou virement bancaire.';
      return;
    }
    paymentMethodError.textContent = '';
    payState.textContent = 'Enregistrement sécurisé de la commande…';
    try {
      apiConfig = apiConfig || await fetch('/api/config').then(r => r.json());
      if (paymentMethod.value === 'paypal' && !apiConfig.paypalReady) {
        payState.innerHTML = '<strong>PayPal n’est pas encore activé.</strong><br>Les identifiants API doivent être ajoutés dans la configuration sécurisée du site avant la mise en ligne.';
        return;
      }
      if (paymentMethod.value === 'bank_transfer' && !apiConfig.bankTransferReady) {
        payState.innerHTML = '<strong>Le virement bancaire est prévu, mais les coordonnées bancaires ne sont pas encore configurées.</strong><br>Le titulaire et l’IBAN doivent être ajoutés dans la configuration sécurisée avant la mise en ligne.';
        return;
      }
      const order = await saveOrder();
      document.querySelector('#order-number-preview').textContent = order.id;
      if (paymentMethod.value === 'paypal') await initPaypal(order);
      else await initBankTransfer(order);
    } catch (err) {
      payState.textContent = err.message;
    }
  }

  form.querySelector('#prepare-payment').addEventListener('click', initPayment);
  showStep(0);
})();
