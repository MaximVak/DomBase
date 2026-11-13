export function validEmail(value) {
  return typeof value === "string" && value === value.trim() && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value);
}
export function backupEmailConfig(env) {
  const recipient = validEmail(env.BACKUP_ALERT_TO) ? env.BACKUP_ALERT_TO : null;
  const sender = validEmail(env.BACKUP_ALERT_FROM) ? env.BACKUP_ALERT_FROM : null;
  return { recipient, sender, configured: Boolean(recipient && sender && typeof env.BACKUP_EMAIL?.send === "function") };
}
// Deployment stays pinned to one recipient. Registering a verified sender and
// granting the send binding is an explicit operator step, never a UI action.
export function backupEmailConfigBlock(config) {
  if (!config.vars && !config.send_email) return {};
  const vars = config.vars;
  if (!vars || Object.keys(vars).some(k => !["BACKUP_ALERT_TO", "BACKUP_ALERT_FROM"].includes(k)) || !validEmail(vars.BACKUP_ALERT_TO)) throw new Error("Invalid backup email configuration.");
  if (vars.BACKUP_ALERT_FROM !== undefined && !validEmail(vars.BACKUP_ALERT_FROM)) throw new Error("Invalid backup email sender.");
  const block = { vars: { BACKUP_ALERT_TO: vars.BACKUP_ALERT_TO, ...(vars.BACKUP_ALERT_FROM ? { BACKUP_ALERT_FROM: vars.BACKUP_ALERT_FROM } : {}) } };
  if (config.send_email) {
    if (!vars.BACKUP_ALERT_FROM || JSON.stringify(config.send_email) !== JSON.stringify([{ name: "BACKUP_EMAIL", destination_address: vars.BACKUP_ALERT_TO }])) throw new Error("Backup email must use the fixed recipient binding.");
    block.send_email = config.send_email;
  }
  return block;
}
