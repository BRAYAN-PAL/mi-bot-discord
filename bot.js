// bot.js — Chat con IA 🤖 (Groq/Llama3) para Discord
require("dotenv").config();

const http = require("http");
const { Client, GatewayIntentBits, Events, EmbedBuilder, ChannelType } = require("discord.js");
const Groq = require("groq-sdk");

const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID || "1521594932006223872";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 3000;
const COOLDOWN_MS = 6000;

if (!TOKEN) {
  console.error("❌ Falta TOKEN");
  process.exit(1);
}
if (!GROQ_API_KEY) console.warn("⚠️ Falta GROQ_API_KEY: la IA no responderá.");

// Cliente de Groq
const groq = new Groq({ apiKey: GROQ_API_KEY });

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot activo ✅");
  })
  .listen(PORT, () => console.log(`🌐 Servidor web en puerto ${PORT}`));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

let canalIA;
const ultimoUso = new Map();

function partir(texto, max = 1900) {
  const trozos = [];
  let resto = texto;
  while (resto.length > max) {
    let corte = resto.lastIndexOf("\n", max);
    if (corte < max / 2) corte = resto.lastIndexOf(" ", max);
    if (corte < max / 2) corte = max;
    trozos.push(resto.slice(0, corte));
    resto = resto.slice(corte).trimStart();
  }
  if (resto) trozos.push(resto);
  return trozos;
}

async function construirHistorial(msg) {
  const lote = await msg.channel.messages.fetch({ limit: 12 });
  const limite = Date.now() - 60 * 60 * 1000;
  const mensajes = [];

  for (const m of [...lote.values()].reverse()) {
    if (m.createdTimestamp < limite) continue;
    const texto = (m.cleanContent || "").trim();
    if (!texto) continue;

    if (m.author.id === client.user.id) {
      if (texto.startsWith("⚠️")) continue;
      mensajes.push({ role: "assistant", content: texto });
    } else if (!m.author.bot) {
      const nombre = m.member?.displayName ?? m.author.username;
      mensajes.push({ role: "user", content: `${nombre}: ${texto}` });
    }
  }

  const unido = [];
  for (const m of mensajes) {
    const ultimo = unido[unido.length - 1];
    if (ultimo && ultimo.role === m.role) ultimo.content += `\n${m.content}`;
    else unido.push({ ...m });
  }
  return unido;
}

async function preguntarIA(nombreServidor, mensajesHistorial) {
  const systemMessage = {
    role: "system",
    content: `Eres el asistente de IA del servidor de Discord "${nombreServidor}". ` +
      "Responde en el idioma del usuario (normalmente español), con tono amigable, claro y conciso (menos de 1500 caracteres). " +
      "En este canal hablan varias personas y sus mensajes llevan su nombre al inicio. " +
      "No uses @everyone ni @here. Si no sabes algo, dilo con honestidad."
  };

  const response = await groq.chat.completions.create({
    messages: [systemMessage, ...mensajesHistorial],
    model: "openai/gpt-oss-20b", // 👈 ¡Ahora sí, el código exacto!
  });
  
  return response.choices[0]?.message?.content || "…";
}

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot || msg.guildId !== GUILD_ID || !canalIA || msg.channelId !== canalIA.id) return;
  if (!msg.content.trim()) return;

  if (!GROQ_API_KEY) {
    return msg.reply("⚠️ La IA no está configurada (falta la clave de API).").catch(() => {});
  }

  const ahora = Date.now();
  if (ahora - (ultimoUso.get(msg.author.id) ?? 0) < COOLDOWN_MS) {
    return msg.react("⏳").catch(() => {});
  }
  ultimoUso.set(msg.author.id, ahora);

  try {
    await msg.channel.sendTyping().catch(() => {});
    const historial = await construirHistorial(msg);
    const respuesta = await preguntarIA(msg.guild.name, historial);

    const trozos = partir(respuesta);
    await msg.reply({ content: trozos[0], allowedMentions: { parse: [], repliedUser: false } });
    for (const t of trozos.slice(1)) {
      await msg.channel.send({ content: t, allowedMentions: { parse: [] } });
    }
  } catch (err) {
    console.error("Error IA:", err.message);
    await msg
      .reply({ content: "⚠️ No pude responder ahora, intenta de nuevo en un momento.", allowedMentions: { parse: [] } })
      .catch(() => {});
  }
});

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Conectado como ${c.user.tag}`);
  try {
    const guild = await c.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();

    canalIA = guild.channels.cache.find((ch) => ch.type === ChannelType.GuildText && ch.name.includes("chat-ia"));

    if (!canalIA) {
      canalIA = await guild.channels.create({
        name: "🤖┃chat-ia",
        type: ChannelType.GuildText,
        topic: "Habla con la IA: escribe tu pregunta y te responde",
      });
      console.log("➕ Canal creado: 🤖┃chat-ia");
    }
    console.log(`🤖 IA escuchando en: #${canalIA.name}`);
  } catch (err) {
    console.error("❌ Error al iniciar:", err);
  }
});

client.on(Events.Error, (e) => console.error("Error del cliente:", e.message));
client.login(TOKEN).catch((e) => {
  console.error("❌ No pude iniciar sesión:", e.message);
  process.exit(1);
});