import { REGISTRATION_CODE_TTL_MS } from "@/lib/auth/registration-policy";

export type AuthEmailTemplate = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function emailLayout(title: string, message: string, action: string, url: string, expiration: string, ignore: string) {
  const safeUrl = escapeHtml(url);
  return `<!doctype html>
<html lang="fr">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#080808;color:#f5f1e8;font-family:Arial,sans-serif">
    <main style="max-width:620px;margin:0 auto;padding:48px 24px">
      <p style="color:#c6a15b;font-size:12px;letter-spacing:2px;text-transform:uppercase">LNX Beats</p>
      <h1 style="font-family:Georgia,serif;font-size:36px;font-weight:400">${escapeHtml(title)}</h1>
      <p style="color:#c8c3ba;line-height:1.6">${escapeHtml(message)}</p>
      <p style="margin:32px 0"><a href="${safeUrl}" style="display:inline-block;padding:14px 18px;background:#c6a15b;color:#080808;text-decoration:none;font-weight:700">${escapeHtml(action)}</a></p>
      <p style="color:#9b968d;font-size:14px">${escapeHtml(expiration)}</p>
      <p style="color:#9b968d;font-size:14px">${escapeHtml(ignore)}</p>
    </main>
  </body>
</html>`;
}

function registrationCodeExpiration() {
  if (!Number.isSafeInteger(REGISTRATION_CODE_TTL_MS) || REGISTRATION_CODE_TTL_MS <= 0 || REGISTRATION_CODE_TTL_MS % 60_000 !== 0) {
    throw new Error("Registration code TTL must be a positive whole number of minutes.");
  }
  const minutes = REGISTRATION_CODE_TTL_MS / 60_000;
  return `Ce code expire dans ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

function registrationCodeCopy() {
  return {
    title: "Vérifiez votre adresse",
    message: "Saisissez ce code sur LNX Beats pour poursuivre la création de votre espace membre.",
    copyHint: "Copiez-collez les 6 chiffres sans espace.",
    expiration: registrationCodeExpiration(),
    security: "Ce code est personnel. Ne le communiquez à personne : LNX Beats ne vous le demandera jamais par téléphone ou par message.",
    ignore: "Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail. Aucun compte ne sera créé sans ce code.",
  } as const;
}

function codeEmailLayout(code: string, copy: ReturnType<typeof registrationCodeCopy>) {
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="dark">
    <title>Votre code LNX Beats</title>
  </head>
  <body style="margin:0;background:#0d0d0d;color:#f6f2e8;font-family:Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">Utilisez ce code à six chiffres pour poursuivre votre inscription.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#0d0d0d">
      <tr>
        <td align="center" style="padding:24px 12px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;background:#171717;border:1px solid #3b3425;border-radius:16px">
            <tr><td style="padding:30px 28px 12px;color:#d9b85b;font:700 13px Arial,sans-serif;letter-spacing:.16em">LNX BEATS · ESPACE MEMBRE</td></tr>
            <tr><td style="padding:0 28px 10px"><h1 style="margin:0;color:#fffaf0;font:700 28px/1.2 Arial,sans-serif">${escapeHtml(copy.title)}</h1></td></tr>
            <tr><td style="padding:0 28px 24px;color:#cfc8b9;font:16px/1.65 Arial,sans-serif">${escapeHtml(copy.message)}</td></tr>
            <tr>
              <td style="padding:0 28px 10px;color:#9f988a;font:700 11px Arial,sans-serif;letter-spacing:.14em">CODE DE VÉRIFICATION</td>
            </tr>
            <tr>
              <td style="padding:0 28px">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#0f0f0f;border:1px solid #51472f;border-radius:12px">
                  <tr><td align="center" style="padding:22px 12px;color:#fff8e7;font:700 38px/1.2 'Courier New',monospace;letter-spacing:.18em;white-space:nowrap;user-select:all">${escapeHtml(code)}</td></tr>
                </table>
              </td>
            </tr>
            <tr><td style="padding:10px 28px 0;color:#aaa394;font:13px/1.5 Arial,sans-serif">${escapeHtml(copy.copyHint)}</td></tr>
            <tr><td style="padding:24px 28px 8px;color:#e4c96f;font:700 14px/1.5 Arial,sans-serif">${escapeHtml(copy.expiration)}</td></tr>
            <tr><td style="padding:0 28px 12px;color:#b9b2a4;font:14px/1.6 Arial,sans-serif">${escapeHtml(copy.security)}</td></tr>
            <tr><td style="padding:0 28px 30px;color:#8f897c;font:13px/1.6 Arial,sans-serif">${escapeHtml(copy.ignore)}</td></tr>
            <tr><td style="padding:18px 28px;border-top:1px solid #332e24;color:#8f897c;font:12px/1.5 Arial,sans-serif">E-mail de sécurité automatique · LNX Beats</td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function registrationCodeEmailTemplate(code: string): AuthEmailTemplate {
  if (!/^\d{6}$/.test(code)) throw new Error("A six-digit registration code is required.");
  const copy = registrationCodeCopy();
  return {
    subject: "Votre code LNX Beats",
    text: `LNX BEATS · ESPACE MEMBRE\n\n${copy.title}\n\n${copy.message}\n\nCODE DE VÉRIFICATION\n${code}\n\n${copy.copyHint}\n${copy.expiration}\n\n${copy.security}\n\n${copy.ignore}\n\nE-mail de sécurité automatique · LNX Beats`,
    html: codeEmailLayout(code, copy),
  };
}

export function verificationEmailTemplate(url: string): AuthEmailTemplate {
  const title = "Confirmez votre adresse email";
  const message = "Vous venez de créer un espace membre LNX Beats. Confirmez cette adresse pour pouvoir vous connecter.";
  const expiration = "Ce lien reste valable pendant 60 minutes et ne peut être utilisé qu’une fois.";
  const ignore = "Si vous n’êtes pas à l’origine de cette inscription, ignorez simplement ce message.";
  return {
    subject: "Confirmez votre adresse email — LNX Beats",
    text: `LNX Beats\n\n${message}\n\nConfirmer mon adresse : ${url}\n\n${expiration}\n${ignore}`,
    html: emailLayout(title, message, "Confirmer mon adresse", url, expiration, ignore),
  };
}

export function resetPasswordEmailTemplate(url: string): AuthEmailTemplate {
  const title = "Choisissez un nouveau mot de passe";
  const message = "Une demande de réinitialisation a été reçue pour votre espace LNX Beats.";
  const expiration = "Ce lien reste valable pendant 30 minutes et ne peut être utilisé qu’une fois.";
  const ignore = "Si vous n’avez pas demandé ce changement, ignorez ce message et conservez votre mot de passe actuel.";
  return {
    subject: "Réinitialisez votre mot de passe — LNX Beats",
    text: `LNX Beats\n\n${message}\n\nRéinitialiser mon mot de passe : ${url}\n\n${expiration}\n${ignore}`,
    html: emailLayout(title, message, "Réinitialiser mon mot de passe", url, expiration, ignore),
  };
}
