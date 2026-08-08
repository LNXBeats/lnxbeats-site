(() => {
  const root = document.querySelector('#admin-root');
  if (!root) return;
  const keyInput = document.querySelector('#admin-key');
  const login = document.querySelector('#admin-login');
  const status = document.querySelector('#admin-status');
  const table = document.querySelector('#orders-table tbody');
  let key = sessionStorage.getItem('lnxAdminKey') || '';
  if (key) keyInput.value = key;

  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paymentLabel = o => {
    if (o.paymentStatus === 'paid') return '50 € payé';
    if (o.paymentMethod === 'bank_transfer') return 'Virement attendu';
    return 'PayPal en attente';
  };
  const paymentMethodLabel = o => o.paymentMethod === 'bank_transfer' ? 'Virement bancaire' : 'PayPal';

  async function load() {
    key = keyInput.value.trim();
    if (!key) return;
    status.textContent = 'Chargement…';
    const r = await fetch('/api/admin/orders', { headers: { 'x-admin-key': key } });
    const j = await r.json();
    if (!r.ok) { status.textContent = j.error || 'Accès refusé.'; return; }
    sessionStorage.setItem('lnxAdminKey', key);
    status.textContent = `${j.length} commande(s)`;
    table.innerHTML = j.map(o => `<tr>
      <td><strong>${esc(o.id)}</strong><br><small>${new Date(o.createdAt).toLocaleString('fr-FR')}</small></td>
      <td>${esc(o.customer.firstName)} ${esc(o.customer.lastName)}<br><small>${esc(o.customer.email)} ${esc(o.customer.phone)}</small></td>
      <td>${esc(o.brief.genre)}<br><small>${esc((o.brief.moods||[]).join(', '))}</small></td>
      <td><div class="payment-admin"><span class="pill ${o.paymentStatus === 'paid' ? 'paid' : (o.paymentMethod === 'bank_transfer' ? 'bank' : '')}">${paymentLabel(o)}</span><small>${paymentMethodLabel(o)}</small>${o.paymentMethod === 'bank_transfer' && o.paymentStatus !== 'paid' ? `<select class="payment-select" data-id="${esc(o.id)}"><option value="awaiting_bank_transfer">En attente</option><option value="paid">Virement reçu</option></select>` : ''}</div></td>
      <td><select class="order-status" data-id="${esc(o.id)}"><option>En attente de paiement</option><option>À créer</option><option>En cours</option><option>Terminée</option><option>Envoyée</option><option>Annulée</option></select></td>
      <td><details><summary>Brief</summary><div class="brief"><strong>Pour :</strong> ${esc(o.brief.recipientName || o.brief.recipientType)}<br><strong>Occasion :</strong> ${esc(o.brief.occasion)}<br><strong>Délai :</strong> ${esc(o.deliveryDays || 7)} jours après paiement<br><strong>Usage :</strong> ${esc(o.brief.usage)}<br><strong>Histoire :</strong><br>${esc(o.brief.story).replace(/\n/g,'<br>')}<br><strong>À éviter :</strong> ${esc(o.brief.exclusions)}</div></details></td>
    </tr>`).join('');

    table.querySelectorAll('.order-status').forEach(sel => {
      const order = j.find(o => o.id === sel.dataset.id); sel.value = order.status;
      sel.addEventListener('change', async () => {
        const rr = await fetch(`/api/admin/orders/${encodeURIComponent(sel.dataset.id)}`, { method:'PATCH', headers:{'Content-Type':'application/json','x-admin-key':key}, body:JSON.stringify({status:sel.value}) });
        if (!rr.ok) alert('Impossible de modifier le statut.');
      });
    });

    table.querySelectorAll('.payment-select').forEach(sel => {
      const order = j.find(o => o.id === sel.dataset.id);
      sel.value = order.paymentStatus === 'paid' ? 'paid' : 'awaiting_bank_transfer';
      sel.addEventListener('change', async () => {
        const rr = await fetch(`/api/admin/orders/${encodeURIComponent(sel.dataset.id)}/payment`, { method:'PATCH', headers:{'Content-Type':'application/json','x-admin-key':key}, body:JSON.stringify({paymentStatus:sel.value}) });
        const jj = await rr.json().catch(() => ({}));
        if (!rr.ok) { alert(jj.error || 'Impossible de modifier le paiement.'); return; }
        await load();
      });
    });
  }
  login.addEventListener('click', load);
  if (key) load();
})();
