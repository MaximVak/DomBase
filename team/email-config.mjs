import { validEmail } from "../backup/email-config.mjs";

export function invitationEmailConfig(env = {}) {
  let origin = null;
  try {
    const url = new URL(env.INVITATION_EMAIL_ORIGIN);
    if (url.protocol === "https:" && url.origin === env.INVITATION_EMAIL_ORIGIN && !url.username && !url.password) origin = url.origin;
  } catch { /* Missing configuration leaves delivery disabled. */ }
  const sender = validEmail(env.INVITATION_EMAIL_FROM) ? env.INVITATION_EMAIL_FROM : null;
  const replyTo = validEmail(env.INVITATION_EMAIL_REPLY_TO) ? env.INVITATION_EMAIL_REPLY_TO : null;
  return { origin, sender, replyTo, configured: Boolean(origin && sender && replyTo && typeof env.INVITATION_EMAIL?.send === "function") };
}

export function invitationEmailConfigBlock(config) {
  const names = ["INVITATION_EMAIL_FROM", "INVITATION_EMAIL_ORIGIN", "INVITATION_EMAIL_REPLY_TO"];
  const vars = Object.fromEntries(names.filter(name => config.vars?.[name] !== undefined).map(name => [name, config.vars[name]]));
  if (!Object.keys(vars).length && !config.send_email) return {};
  const checked = invitationEmailConfig({ ...vars, INVITATION_EMAIL: { send() {} } });
  if (!checked.configured || Object.keys(config.vars ?? {}).some(name => !names.includes(name))
    || JSON.stringify(config.send_email) !== JSON.stringify([{ name: "INVITATION_EMAIL", allowed_sender_addresses: [checked.sender] }])) throw new Error("Invalid invitation email configuration.");
  return { vars, send_email: config.send_email };
}
