const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const config = require('./config');
const {
  state: adminState,
  estAdmin,
  estProprietaire,
  extraireCible,
  LIMITE_WARN,
  LIEN_REGEX,
} = require('./admin');

const PROFILE_PICTURE_PATH = './profile.jpg';
const PROFILE_FLAG_PATH = './.profile-set';

const messageStore = new Map();
let presenceInterval;
const statusViews = new Map();

// Fonction pour avoir l'heure du Mali GMT+0
function heureBamako() {
  const options = { timeZone: 'Africa/Bamako', hour: '2-digit', minute: '2-digit', second: '2-digit' };
  return new Date().toLocaleTimeString('en-GB', options);
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.macOS(config.botName),
  });

  if (!sock.authState.creds.registered) {
    const numero = config.phoneNumber.replace(/[^0-9]/g, '');
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(numero, config.pairingCode);
        console.log('🔑 Pairing Code : ' + code);
        console.log(`[${heureBamako()}] ➡️ WhatsApp > Settings > Linked Devices > Link with phone number`);
      } catch (e) {
        console.log('❌ Error pairing code :', e);
      }
    }, 3000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode!== DisconnectReason.loggedOut;
      console.log(`[${heureBamako()}] Connection closed. Reconnecting:`, shouldReconnect);
      if (shouldReconnect) startBot();
      clearInterval(presenceInterval);
    } else if (connection === 'open') {
      console.log(`[${heureBamako()}] ✅ ${config.botName} is connected!`);
      if (fs.existsSync(PROFILE_PICTURE_PATH) &&!fs.existsSync(PROFILE_FLAG_PATH)) {
        sock.updateProfilePicture(sock.user.id, { url: PROFILE_PICTURE_PATH })
         .then(() => {
            console.log(`[${heureBamako()}] 🖼️ Profile picture updated.`);
            fs.writeFileSync(PROFILE_FLAG_PATH, 'ok');
          })
         .catch((e) => console.log('❌ Profile pic error :', e));
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;
    messageStore.set(msg.key.id, msg);
    if (msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const texte = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
    const estGroupe = from.endsWith('@g.us');
    const senderJid = msg.key.participant || from;
    let participants = [];
    if (estGroupe) {
      try {
        const meta = await sock.groupMetadata(from);
        participants = meta.participants;
      } catch (e) {}
    }
    const autorise = estGroupe && (estAdmin(participants, senderJid) || estProprietaire(senderJid, config));

    // Anti-link
    if (estGroupe && adminState.antilink.has(from) && LIEN_REGEX.test(texte) &&!estAdmin(participants, senderJid)) {
      try { await sock.sendMessage(from, { delete: msg.key }); } catch (e) {}
      const cle = `${from}_${senderJid}`;
      const count = (adminState.warns.get(cle) || 0) + 1;
      adminState.warns.set(cle, count);
      await sock.sendMessage(from, {
        text: `🔗 Link detected and deleted. Warning ${count}/${LIMITE_WARN} for @${senderJid.split('@')[0]}`,
        mentions: [senderJid],
      });
      if (count >= LIMITE_WARN) {
        try { await sock.groupParticipantsUpdate(from, [senderJid], 'remove'); } catch (e) {}
        adminState.warns.delete(cle);
      }
      return;
    }

    if (!texte.startsWith(config.prefix)) return;
    const args = texte.slice(config.prefix.length).trim().split(' ');
    const commande = args[0].toLowerCase();

    switch (commande) {
      case 'menu':
      case 'help':
        await sock.sendMessage(from, {
          text:
            `🤖 *${config.botName}*\n` +
            `Time: ${heureBamako()} GMT\n\n` +
            `Prefix : ${config.prefix}\n\n` +
            `*General :*\n` +
            `${config.prefix}menu - Show this menu\n` +
            `${config.prefix}ping - Check bot speed\n` +
            `${config.prefix}info - Bot info\n` +
            `${config.prefix}owner - Owner contact\n` +
            `${config.prefix}runtime - Bot uptime\n` +
            `*New Commands :*\n` +
            `${config.prefix}alwaysonline on/off - Stay always online\n` +
            `${config.prefix}ghoststatus on/off - View status without seen\n` +
            `${config.prefix}likestatus @number - React 💖 to someone's status\n` +
            `${config.prefix}antidelete on/off - See deleted messages\n` +
            `${config.prefix}uniqueviews - See unique views of your status\n` +
            `*Group Admin :*\n` +
            `${config.prefix}kick, ${config.prefix}add, ${config.prefix}promote, ${config.prefix}demote\n` +
            `${config.prefix}mute, ${config.prefix}unmute, ${config.prefix}groupinfo, ${config.prefix}linkgc\n` +
            `${config.prefix}tagall, ${config.prefix}hidetag <msg>, ${config.prefix}warn, ${config.prefix}banlist\n` +
            `${config.prefix}antibot on/off, ${config.prefix}antilink on/off, ${config.prefix}welcome on/off\n\n` +
            `${config.credit}`,
        });
        break;

      case 'ping': {
        const debut = Date.now();
        await sock.sendMessage(from, { text: 'Calculating...' });
        const latence = Date.now() - debut;
        await sock.sendMessage(from, { text: `🏓 Pong! ${latence} ms | ${heureBamako()}` });
        break;
      }

      case 'info':
        await sock.sendMessage(from, {
          text: `🤖 *${config.botName}*\nTime: ${heureBamako()} GMT\nA WhatsApp automated assistant.\n\n${config.credit}`,
        });
        break;

      case 'owner':
        await sock.sendMessage(from, { text: `👤 This bot belongs to Tiekoura Samaké.\nTime: ${heureBamako()}\n\n${config.credit}` });
        break;

      case 'runtime': {
        const uptime = process.uptime();
        const h = Math.floor(uptime / 3600);
        const m = Math.floor((uptime % 3600) / 60);
        await sock.sendMessage(from, { text: `⏱️ Online for ${h}h ${m}min | ${heureBamako()}` });
        break;
      }

      // ===== 5 NEW COMMANDS =====
      case 'alwaysonline': {
        const val = args[1];
        if (val === 'on') {
          presenceInterval = setInterval(() => { sock.sendPresenceUpdate('available'); }, 15000);
          await sock.sendMessage(from, { text: `🟢 Always Online mode: ON | ${heureBamako()}` });
        } else if (val === 'off') {
          clearInterval(presenceInterval);
          await sock.sendMessage(from, { text: `🔴 Always Online mode: OFF | ${heureBamako()}` });
        } else {
          await sock.sendMessage(from, { text: `Usage: ${config.prefix}alwaysonline on/off` });
        }
        break;
      }

      case 'ghoststatus': {
        const val = args[1];
        if (val === 'on') {
          adminState.ghostStatus = true;
          await sock.sendMessage(from, { text: `👻 Ghost Status: ON. You can view statuses without being seen.` });
        } else if (val === 'off') {
          adminState.ghostStatus = false;
          await sock.sendMessage(from, { text: `👁️ Ghost Status: OFF` });
        } else {
          await sock.sendMessage(from, { text: `Usage: ${config.prefix}ghoststatus on/off` });
        }
        break;
      }

      case 'likestatus': {
        const cible = args[1];
        if (!cible) { await sock.sendMessage(from, { text: `⚠️ Usage: ${config.prefix}likestatus 22376xxxxxx` }); break; }
        const jid = cible.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await sock.sendMessage(jid, { text: '💖' });
        await sock.sendMessage(from, { text: `✅ Sent 💖 to @${cible}`, mentions: [jid] });
        break;
      }

      case 'antidelete': {
        const val = args[1];
        if (val === 'on') {
          adminState.antiDelete = true;
          await sock.sendMessage(from, { text: `🚫 Anti-Delete: ON. Deleted messages will be resent.` });
        } else if (val === 'off') {
          adminState.antiDelete = false;
          await sock.sendMessage(from, { text: `✅ Anti-Delete: OFF` });
        } else {
          await sock.sendMessage(from, { text: `Usage: ${config.prefix}antidelete on/off` });
        }
        break;
      }

      case 'uniqueviews': {
        if (!statusViews.has(sock.user.id)) {
          await sock.sendMessage(from, { text: '📊 No status data yet.' });
          break;
        }
        const stats = statusViews.get(sock.user.id);
        let texteStats = `📊 *Unique Views of Your Status*\nTime: ${heureBamako()}\n\n`;
        stats.forEach((vues, idStatut) => {
          texteStats += `Status ${idStatut.slice(0,6)}: ${vues.size} unique views\n`;
        });
        await sock.sendMessage(from, { text: texteStats });
        break;
      }

      // ===== Group Admin Commands =====
      case 'kick': {
        if (!estGroupe) { await sock.sendMessage(from, { text: '⚠️ Group only command.' }); break; }
        if (!autorise) { await sock.sendMessage(from, { text: '🚫 Admin only.' }); break; }
        const cible = extraireCible(msg);
        if (!cible) { await sock.sendMessage(from, { text: '⚠️ Mention or reply to the person to kick.' }); break; }
        await sock.groupParticipantsUpdate(from, [cible], 'remove');
        await sock.sendMessage(from, { text: `✅ @${cible.split('@')[0]} has been kicked.`, mentions: [cible] });
        break;
      }

      // Colle ici toutes tes autres commandes: add, promote, demote, mute, unmute, groupinfo, linkgc, tagall, hidetag, warn, banlist, antibot, antilink, welcome

      default:
        await sock.sendMessage(from, { text: `❓ Unknown command. Type ${config.prefix}menu to see commands.` });
    }
  });

  // Track status views
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (msg.message?.statusMessage) {
      const idStatut = msg.key.id;
      const viewer = msg.key.remoteJid;
      if (!statusViews.has(sock.user.id)) statusViews.set(sock.user.id, new Map());
      const map = statusViews.get(sock.user.id);
      if (!map.has(idStatut)) map.set(idStatut, new Set());
      map.get(idStatut).add(viewer);
    }
  });

  // Welcome message
  sock.ev.on('group-participants.update', async (evt) => {
    if (evt.action === 'add' && adminState.welcome.has(evt.id)) {
      for (const jid of evt.participants) {
        await sock.sendMessage(evt.id, { text: `👋 Welcome @${jid.split('@')[0]} to the group!`, mentions: [jid] });
      }
    }
  });

  // Anti-delete
  sock.ev.on('messages.update', async (updates) => {
    for (const item of updates) {
      const { key, update: upd } = item;
      const isDeleted = upd?.messageStubType === 68 || upd?.message === null;
      if (!isDeleted ||!adminState.antiDelete) continue;
      const original = messageStore.get(key.id);
      if (!original) continue;
      const contenu = original.message?.conversation || original.message?.extendedTextMessage?.text || '[media]';
      const expediteur = original.key.participant || original.key.remoteJid;
      await sock.sendMessage(key.remoteJid, {
        text: `🚫 *Deleted Message Detected*\nTime: ${heureBamako()}\nFrom: @${expediteur.split('@')[0]}\nContent: ${contenu}`,
        mentions: [expediteur]
      });
    }
  });

  // Ghost Status
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (msg.message?.statusMessage && adminState.ghostStatus) {
      await sock.readMessages([msg.key]);
    }
  });
}

startBot();