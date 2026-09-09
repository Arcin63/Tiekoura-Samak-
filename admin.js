// Gestion des fonctionnalités d'administration de groupe

const state = {
  antilink: new Set(), // IDs de groupes où l'anti-lien est actif
  welcome: new Set(), // IDs de groupes où le message de bienvenue est actif
  antibot: new Set(), // IDs de groupes où l'anti-bot est actif
  warns: new Map(), // clé "groupe_jid" -> nombre d'avertissements
  antiDelete: false, // AJOUTÉ: Activer/désactiver anti-suppression
  ghostStatus: false, // AJOUTÉ: Activer/désactiver mode fantôme pour les statuts
};

const LIMITE_WARN = 3;
const LIEN_REGEX = /(https?:\/\/|chat\.whatsapp\.com|wa\.me\/)/i;

function estAdmin(participants, jid) {
  const p = participants.find((p) => p.id === jid);
  return p?.admin === 'admin' || p?.admin === 'superadmin';
}

function estProprietaire(jid, config) {
  const numero = config.phoneNumber.replace(/[^0-9]/g, '');
  return jid === `${numero}@s.whatsapp.net`;
}

function extraireCible(msg) {
  const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  if (mentions && mentions.length > 0) return mentions[0];
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (quoted) return quoted;
  return null;
}

module.exports = { state, estAdmin, estProprietaire, extraireCible, LIMITE_WARN, LIEN_REGEX };