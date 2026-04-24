import { GoogleGenerativeAI } from "@google/generative-ai";
import TelegramBot from 'node-telegram-bot-api';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SseClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

// Configuración de variables
const token = process.env.TELEGRAM_TOKEN;
const apiKey = process.env.GEMINI_API_KEY;
const mcpUrl = process.env.GARMIN_MCP_URL;

if (!token || !apiKey || !mcpUrl) {
  console.error("❌ Faltan variables de entorno. Chequeá Railway.");
  process.exit(1);
}

const bot = new TelegramBot(token, {polling: true});
const genAI = new GoogleGenerativeAI(apiKey);

// 1. Conectar con el servidor MCP de Garmin
const transport = new SseClientTransport(new URL(mcpUrl));
const mcpClient = new Client({ name: "Telegram-Coach-Bridge", version: "1.0.0" }, { capabilities: {} });

async function startCoach() {
  try {
    await mcpClient.connect(transport);
    console.log("✅ Conectado al servidor de Garmin en Railway");

    const { tools } = await mcpClient.listTools();
    
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro",
      systemInstruction: "Sos un Head Coach de Triatlón experto. Tu atleta es Edgardo. Objetivo: Sub-11 en Cozumel. FTP: 200W. Usá los datos de Garmin para ajustar el plan.",
      tools: [{ functionDeclarations: tools }]
    });

    const chat = model.startChat();

    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      if (!msg.text) return;

      try {
        let result = await chat.sendMessage(msg.text);
        let response = result.response;

        // Si Gemini necesita datos de Garmin
        const calls = response.functionCalls();
        if (calls) {
          const toolResults = [];
          for (const call of calls) {
            const { name, args } = call;
            const toolResult = await mcpClient.callTool({ name, arguments: args });
            toolResults.push({
                functionResponse: {
                    name,
                    response: toolResult
                }
            });
          }
          // Devolver los datos de Garmin a Gemini
          result = await chat.sendMessage(toolResults);
          response = result.response;
        }

        bot.sendMessage(chatId, response.text());
      } catch (e) {
        console.error(e);
        bot.sendMessage(chatId, "Hubo un error analizando los datos. ¡Seguí pedaleando!");
      }
    });

  } catch (error) {
    console.error("❌ Error de conexión:", error);
  }
}

startCoach();
