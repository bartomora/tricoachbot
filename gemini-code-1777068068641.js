const { GoogleGenerativeAI } = require("@google/generative-ai");
const TelegramBot = require('node-telegram-bot-api');
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { SseClientTransport } = require("@modelcontextprotocol/sdk/client/sse.js");

// Configuración de variables de entorno
const token = process.env.TELEGRAM_TOKEN;
const apiKey = process.env.GEMINI_API_KEY;
const mcpUrl = process.env.GARMIN_MCP_URL;

const bot = new TelegramBot(token, {polling: true});
const genAI = new GoogleGenerativeAI(apiKey);

// 1. Conectar con el servidor MCP de Garmin en Railway
const transport = new SseClientTransport(new URL(mcpUrl));
const mcpClient = new Client({ name: "Telegram-Coach-Bridge", version: "1.0.0" });

async function startCoach() {
  await mcpClient.connect(transport);
  console.log("✅ Conectado al servidor de Garmin");

  // Obtener herramientas disponibles en el MCP
  const { tools } = await mcpClient.listTools();
  
  // Configurar el modelo Gemini con tu System Prompt
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro",
    systemInstruction: `Actúa como un Head Coach de Triatlón. Tu objetivo es el Sub-11 en Cozumel para Edgardo. 
    FTP: 200W. Regla de oro: Estómago vacío los últimos 15' de bici. 
    Usa las herramientas de Garmin para auditar HRV, carga y potencia.`,
    tools: [{ functionDeclarations: tools }] // Mapea las herramientas de Garmin a Gemini
  });

  const chat = model.startChat();

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userText = msg.text;

    try {
      // Enviar mensaje a Gemini
      let result = await chat.sendMessage(userText);
      let response = result.response;

      // Si Gemini quiere usar una herramienta (Garmin)
      const calls = response.functionCalls();
      if (calls) {
        const toolResults = {};
        for (const call of calls) {
          const { name, args } = call;
          console.log(`🔍 Consultando Garmin: ${name}`);
          const toolResult = await mcpClient.callTool({ name, arguments: args });
          toolResults[name] = toolResult;
        }
        // Enviar resultados de vuelta a Gemini para que finalice su respuesta
        result = await chat.sendMessage(Object.values(toolResults));
        response = result.response;
      }

      bot.sendMessage(chatId, response.text());
    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, "⚠️ Lo siento, tuve un problema al consultar tus datos de Garmin.");
    }
  });
}

startCoach();