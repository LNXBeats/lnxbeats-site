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

function codeEmailLayout(code: string) {
  const title = "Votre code LNX Beats";
  const message = "Votre code de vérification est :";
  const expiration = "Ce code expire dans 10 minutes.";
  const ignore = "Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.";
  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;background:#080808;color:#f5f1e8;font-family:Arial,sans-serif">
    <main style="max-width:620px;margin:0 auto;padding:48px 24px">
      <p style="color:#c6a15b;font-size:12px;letter-spacing:2px;text-transform:uppercase">LNX Beats</p>
      <h1 style="font-family:Georgia,serif;font-size:36px;font-weight:400">${escapeHtml(title)}</h1>
      <p style="color:#c8c3ba;line-height:1.6">${escapeHtml(message)}</p>
      <p style="margin:32px 0;font-family:Georgia,serif;font-size:42px;letter-spacing:12px">${escapeHtml(code)}</p>
      <p style="color:#9b968d;font-size:14px">${escapeHtml(expiration)}</p>
      <p style="color:#9b968d;font-size:14px">${escapeHtml(ignore)}</p>
    </main>
  </body>
</html>`;
}

export function registrationCodeEmailTemplate(code: string): AuthEmailTemplate {
  if (!/^\d{6}$/.test(code)) throw new Error("A six-digit registration code is required.");
  const message = "Votre code de vérification est :";
  const expiration = "Ce code expire dans 10 minutes.";
  const ignore = "Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.";
  return {
    subject: "Votre code LNX Beats",
    text: `LNX Beats\n\n${message}\n\n${code}\n\n${expiration}\n${ignore}`,
    html: codeEmailLayout(code),
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
