import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const PRICE_EUR = '50.00';
const DELIVERY_DAYS = 7;
const PERSISTENT_ROOT = process.env.PERSISTENT_ROOT ? path.resolve(process.env.PERSISTENT_ROOT) : __dirname;
const DATA_DIR = path.join(PERSISTENT_ROOT, 'data');
const UPLOAD_DIR = path.join(PERSISTENT_ROOT, 'uploads');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.mkdir(UPLOAD_DIR, { recursive: true });

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 150, standardHeaders: 'draft-8', legacyHeaders: false }));
app.get('/health', (_req, res) => res.status(200).json({ ok: true, service: 'lnx-beats', version: '0.6.0' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

async function readJson(file, fallback = []) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}

async function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}

function cleanText(value, max = 5000) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\0/g, '').slice(0, max);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function adminAuthorized(req) {
  const expected = process.env.ADMIN_KEY || '';
  const supplied = req.get('x-admin-key') || '';
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)); }
  catch { return false; }
}

function bankDetails() {
  return {
    accountHolder: cleanText(process.env.BANK_ACCOUNT_HOLDER || '', 200),
    iban: cleanText(process.env.BANK_IBAN || '', 80),
    bic: cleanText(process.env.BANK_BIC || '', 40),
    bankName: cleanText(process.env.BANK_NAME || '', 120)
  };
}

function bankTransferReady() {
  const b = bankDetails();
  return Boolean(b.accountHolder && b.iban);
}

const allowedMime = new Set([
  'image/jpeg','image/png','image/webp','application/pdf','text/plain',
  'audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav'
]);
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { files: 5, fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, allowedMime.has(file.mimetype))
});

function nextOrderId(orders) {
  const year = new Date().getFullYear();
  const prefix = `LNX-${year}-`;
  const max = orders.reduce((m, o) => {
    if (!o.id?.startsWith(prefix)) return m;
    const n = Number(o.id.split('-').at(-1));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

async function sendMailMaybe({ to, subject, html }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !to) return false;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, subject, html
  });
  return true;
}

function paypalBase() {
  return process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

async function paypalAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error('PayPal non configuré');
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const response = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  if (!response.ok) throw new Error(`Erreur authentification PayPal (${response.status})`);
  return (await response.json()).access_token;
}

function paymentConfirmationHtml(order) {
  return `<h2>Merci ${order.customer.firstName} !</h2>
    <p>Le paiement de votre commande <strong>${order.id}</strong> est confirmé.</p>
    <p>Montant : <strong>50,00 €</strong>.</p>
    <p>LNX Beats a reçu votre brief. Le délai annoncé est de <strong>${DELIVERY_DAYS} jours</strong> à compter de la confirmation du paiement et de la réception d'un brief exploitable.</p>
    <p>Une demande de modification raisonnable est incluse.</p>
    <p>La création est destinée à un usage personnel et peut être partagée sur les réseaux de manière non commerciale. Toute exploitation professionnelle ou commerciale nécessite un accord distinct.</p>
    <p>Conservez votre numéro de commande pour vos échanges.</p>`;
}

app.get('/api/config', (_req, res) => {
  res.json({
    price: Number(PRICE_EUR),
    currency: 'EUR',
    deliveryDays: DELIVERY_DAYS,
    paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
    paypalReady: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    paypalMode: process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox',
    bankTransferReady: bankTransferReady()
  });
});

app.post('/api/orders', upload.array('attachments', 5), async (req, res) => {
  try {
    const body = req.body || {};
    const required = ['firstName','lastName','email','recipientType','story','paymentMethod'];
    for (const key of required) {
      if (!cleanText(body[key], 20000)) return res.status(400).json({ error: `Champ requis manquant : ${key}` });
    }
    if (!validEmail(cleanText(body.email, 200))) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    if (!['paypal','bank_transfer'].includes(body.paymentMethod)) return res.status(400).json({ error: 'Mode de paiement invalide.' });
    if (body.termsAccepted !== 'true' || body.confirmAccuracy !== 'true') {
      return res.status(400).json({ error: 'Les validations obligatoires doivent être acceptées.' });
    }
    const letLnxChoose = body.letLnxChooseStyle === 'true';
    if (!letLnxChoose && !cleanText(body.genre, 100)) return res.status(400).json({ error: 'Choisissez un style ou laissez LNX Beats choisir.' });

    const orders = await readJson(ORDERS_FILE, []);
    const id = nextOrderId(orders);
    const moods = (() => { try { return JSON.parse(body.moods || '[]'); } catch { return []; } })();
    const files = (req.files || []).map(f => ({
      originalName: cleanText(f.originalname, 255),
      storedName: path.basename(f.filename),
      mimeType: f.mimetype,
      size: f.size
    }));
    const paymentMethod = body.paymentMethod;
    const order = {
      id,
      createdAt: new Date().toISOString(),
      price: Number(PRICE_EUR), currency: 'EUR',
      deliveryDays: DELIVERY_DAYS,
      paymentMethod,
      paymentStatus: paymentMethod === 'bank_transfer' ? 'awaiting_bank_transfer' : 'pending',
      status: 'En attente de paiement',
      customer: {
        firstName: cleanText(body.firstName, 100), lastName: cleanText(body.lastName, 100),
        email: cleanText(body.email, 200), phone: cleanText(body.phone, 80), country: cleanText(body.country, 100)
      },
      brief: {
        recipientType: cleanText(body.recipientType, 100), recipientName: cleanText(body.recipientName, 100),
        occasion: cleanText(body.occasion, 150), eventDate: cleanText(body.eventDate, 30),
        genre: letLnxChoose ? 'Choix LNX Beats' : cleanText(body.genre, 100), letLnxChooseStyle: letLnxChoose,
        moods: Array.isArray(moods) ? moods.slice(0, 10).map(x => cleanText(String(x), 80)) : [],
        otherMood: cleanText(body.otherMood, 120), voice: cleanText(body.voice, 80),
        story: cleanText(body.story, 12000), meeting: cleanText(body.meeting, 3000), memories: cleanText(body.memories, 3000),
        anecdote: cleanText(body.anecdote, 3000), expressions: cleanText(body.expressions, 2000), places: cleanText(body.places, 2000),
        qualities: cleanText(body.qualities, 2000), message: cleanText(body.message, 3000), ending: cleanText(body.ending, 2000),
        exclusions: cleanText(body.exclusions, 3000), usage: cleanText(body.usage, 100)
      },
      rights: {
        personalUse: true,
        nonCommercialSocialSharing: true,
        commercialUseIncluded: false,
        commercialUseRequiresSeparateAgreement: true
      },
      revisionsIncluded: 1,
      consents: {
        termsAccepted: true,
        confirmAccuracy: true,
        startBeforeWithdrawalEnd: body.startBeforeWithdrawalEnd === 'true'
      },
      attachments: files,
      paypalOrderId: null,
      paypalCaptureId: null,
      bankInstructionsSentAt: null
    };
    orders.push(order);
    await writeJson(ORDERS_FILE, orders);
    res.status(201).json({
      id,
      price: Number(PRICE_EUR),
      currency: 'EUR',
      deliveryDays: DELIVERY_DAYS,
      paymentMethod,
      paymentStatus: order.paymentStatus
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Impossible d’enregistrer la commande.' });
  }
});

app.post('/api/bank-transfer/instructions', async (req, res) => {
  try {
    if (!bankTransferReady()) return res.status(503).json({ error: 'Le virement bancaire n’est pas encore configuré.' });
    const orderId = cleanText(req.body.orderId, 50);
    const orders = await readJson(ORDERS_FILE, []);
    const index = orders.findIndex(o => o.id === orderId);
    if (index < 0) return res.status(404).json({ error: 'Commande introuvable.' });
    const order = orders[index];
    if (order.paymentMethod !== 'bank_transfer') return res.status(400).json({ error: 'Cette commande n’a pas choisi le virement bancaire.' });
    if (order.paymentStatus === 'paid') return res.status(409).json({ error: 'Cette commande est déjà réglée.' });

    const bank = bankDetails();
    order.paymentStatus = 'awaiting_bank_transfer';
    order.status = 'En attente de paiement';

    if (!order.bankInstructionsSentAt) {
      order.bankInstructionsSentAt = new Date().toISOString();
      await writeJson(ORDERS_FILE, orders);
      const customerHtml = `<h2>Commande ${order.id}</h2>
        <p>Votre demande de chanson personnalisée LNX Beats est enregistrée.</p>
        <p>Montant à virer : <strong>50,00 €</strong>.</p>
        <p>Titulaire : <strong>${bank.accountHolder}</strong><br>
        IBAN : <strong>${bank.iban}</strong>${bank.bic ? `<br>BIC : <strong>${bank.bic}</strong>` : ''}${bank.bankName ? `<br>Banque : <strong>${bank.bankName}</strong>` : ''}</p>
        <p>Merci d'indiquer <strong>${order.id}</strong> en référence du virement.</p>
        <p>La création démarre après réception et validation du paiement. Le délai annoncé est ensuite de ${DELIVERY_DAYS} jours.</p>`;
      sendMailMaybe({ to: order.customer.email, subject: `LNX Beats — virement pour ${order.id}`, html: customerHtml }).catch(console.error);
      if (process.env.ADMIN_EMAIL) {
        sendMailMaybe({ to: process.env.ADMIN_EMAIL, subject: `Commande en attente de virement ${order.id}`, html: `<h2>Commande ${order.id}</h2><p>${order.customer.firstName} ${order.customer.lastName} — ${order.customer.email}</p><p>Montant attendu : 50,00 €.</p><p>Référence : ${order.id}</p>` }).catch(console.error);
      }
    } else {
      await writeJson(ORDERS_FILE, orders);
    }

    res.json({
      ok: true,
      id: order.id,
      amount: Number(PRICE_EUR),
      currency: 'EUR',
      reference: order.id,
      bank
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Impossible de préparer le virement.' });
  }
});

app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const orderId = cleanText(req.body.orderId, 50);
    const orders = await readJson(ORDERS_FILE, []);
    const index = orders.findIndex(o => o.id === orderId);
    if (index < 0) return res.status(404).json({ error: 'Commande introuvable.' });
    if (orders[index].paymentMethod !== 'paypal') return res.status(400).json({ error: 'Mode de paiement incohérent.' });
    if (orders[index].paymentStatus === 'paid') return res.status(409).json({ error: 'Commande déjà payée.' });

    const token = await paypalAccessToken();
    const response = await fetch(`${paypalBase()}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': orderId },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: orderId,
          custom_id: orderId,
          description: `Chanson personnalisée LNX Beats — ${orderId}`,
          amount: { currency_code: 'EUR', value: PRICE_EUR }
        }],
        application_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' }
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: 'PayPal a refusé la création du paiement.', detail: data });
    orders[index].paypalOrderId = data.id;
    await writeJson(ORDERS_FILE, orders);
    res.json({ paypalOrderId: data.id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Erreur PayPal.' });
  }
});

app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const orderId = cleanText(req.body.orderId, 50);
    const paypalOrderId = cleanText(req.body.paypalOrderId, 100);
    const orders = await readJson(ORDERS_FILE, []);
    const index = orders.findIndex(o => o.id === orderId);
    if (index < 0) return res.status(404).json({ error: 'Commande introuvable.' });
    if (orders[index].paymentMethod !== 'paypal') return res.status(400).json({ error: 'Mode de paiement incohérent.' });
    if (orders[index].paypalOrderId && orders[index].paypalOrderId !== paypalOrderId) return res.status(400).json({ error: 'Référence PayPal incohérente.' });

    const token = await paypalAccessToken();
    const response = await fetch(`${paypalBase()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `${orderId}-capture` }
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: 'La capture PayPal a échoué.', detail: data });

    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    const amountOk = capture?.amount?.currency_code === 'EUR' && capture?.amount?.value === PRICE_EUR;
    if (data.status !== 'COMPLETED' || !amountOk) return res.status(409).json({ error: 'Paiement non confirmé au montant attendu.' });

    orders[index].paymentStatus = 'paid';
    orders[index].paidAt = new Date().toISOString();
    orders[index].paypalOrderId = paypalOrderId;
    orders[index].paypalCaptureId = capture.id;
    orders[index].status = 'À créer';
    await writeJson(ORDERS_FILE, orders);

    const o = orders[index];
    const siteUrl = process.env.SITE_URL || `http://localhost:${PORT}`;
    sendMailMaybe({ to: o.customer.email, subject: `LNX Beats — commande ${o.id} confirmée`, html: `${paymentConfirmationHtml(o)}<p><a href="${siteUrl}">LNX Beats</a></p>` }).catch(console.error);
    if (process.env.ADMIN_EMAIL) {
      sendMailMaybe({ to: process.env.ADMIN_EMAIL, subject: `Nouvelle commande payée ${o.id}`, html: `<h2>Nouvelle commande LNX Beats</h2><p>${o.customer.firstName} ${o.customer.lastName} — ${o.customer.email}</p><p>Style : ${o.brief.genre}</p><p>Paiement : PayPal</p><p>Commande : <strong>${o.id}</strong></p><p><a href="${siteUrl}/admin.html">Ouvrir l’administration</a></p>` }).catch(console.error);
    }
    res.json({ ok: true, id: o.id, status: o.status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Erreur lors de la validation du paiement.' });
  }
});

app.post('/api/contact', async (req, res) => {
  try {
    const name = cleanText(req.body.name, 150);
    const email = cleanText(req.body.email, 200);
    const subject = cleanText(req.body.subject, 150);
    const message = cleanText(req.body.message, 5000);
    if (!name || !validEmail(email) || !subject || !message) return res.status(400).json({ error: 'Merci de compléter tous les champs.' });
    const contacts = await readJson(CONTACTS_FILE, []);
    contacts.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), name, email, subject, message });
    await writeJson(CONTACTS_FILE, contacts);
    if (process.env.ADMIN_EMAIL) {
      sendMailMaybe({ to: process.env.ADMIN_EMAIL, subject: `Contact LNX Beats — ${subject}`, html: `<p><strong>${name}</strong> — ${email}</p><p>${message.replace(/\n/g,'<br>')}</p>` }).catch(console.error);
    }
    res.json({ ok: true });
  } catch (error) {
    console.error(error); res.status(500).json({ error: 'Impossible d’envoyer le message.' });
  }
});

app.get('/api/admin/orders', async (req, res) => {
  if (!adminAuthorized(req)) return res.status(401).json({ error: 'Accès refusé.' });
  const orders = await readJson(ORDERS_FILE, []);
  res.json(orders.sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))));
});

app.patch('/api/admin/orders/:id/payment', async (req, res) => {
  try {
    if (!adminAuthorized(req)) return res.status(401).json({ error: 'Accès refusé.' });
    const paymentStatus = cleanText(req.body.paymentStatus, 50);
    if (!['awaiting_bank_transfer','paid'].includes(paymentStatus)) return res.status(400).json({ error: 'Statut de paiement invalide.' });
    const orders = await readJson(ORDERS_FILE, []);
    const index = orders.findIndex(o => o.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Commande introuvable.' });
    const order = orders[index];
    if (order.paymentMethod !== 'bank_transfer') return res.status(400).json({ error: 'Ce statut manuel est réservé aux virements bancaires.' });

    const wasPaid = order.paymentStatus === 'paid';
    if (wasPaid && paymentStatus !== 'paid') return res.status(409).json({ error: 'Un virement déjà validé comme reçu ne peut pas être remis en attente depuis cette interface.' });
    order.paymentStatus = paymentStatus;
    order.paymentUpdatedAt = new Date().toISOString();
    if (paymentStatus === 'paid') {
      order.paidAt = order.paidAt || new Date().toISOString();
      if (order.status === 'En attente de paiement') order.status = 'À créer';
    } else if (!wasPaid) {
      order.status = 'En attente de paiement';
    }
    await writeJson(ORDERS_FILE, orders);

    if (paymentStatus === 'paid' && !wasPaid) {
      sendMailMaybe({ to: order.customer.email, subject: `LNX Beats — virement reçu pour ${order.id}`, html: paymentConfirmationHtml(order) }).catch(console.error);
    }
    res.json({ ok: true, order });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Impossible de modifier le statut du paiement.' });
  }
});

app.patch('/api/admin/orders/:id', async (req, res) => {
  if (!adminAuthorized(req)) return res.status(401).json({ error: 'Accès refusé.' });
  const allowed = new Set(['En attente de paiement','À créer','En cours','Terminée','Envoyée','Annulée']);
  const status = cleanText(req.body.status, 50);
  if (!allowed.has(status)) return res.status(400).json({ error: 'Statut invalide.' });
  const orders = await readJson(ORDERS_FILE, []);
  const index = orders.findIndex(o => o.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Commande introuvable.' });
  orders[index].status = status;
  orders[index].updatedAt = new Date().toISOString();
  await writeJson(ORDERS_FILE, orders);
  res.json({ ok: true, order: orders[index] });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `Pièce jointe refusée : ${err.message}` });
  res.status(500).json({ error: 'Erreur serveur.' });
});

app.listen(PORT, () => console.log(`LNX Beats → http://localhost:${PORT}`));
