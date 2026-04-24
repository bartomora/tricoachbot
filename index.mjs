import { GoogleGenerativeAI } from "@google/generative-ai";
import TelegramBot from 'node-telegram-bot-api';
// Cambiamos la forma de importar para evitar el error de constructor
import * as mcpSdk from "@modelcontextprotocol/sdk/client/index.js";
import * as sseSdk from "@modelcontextprotocol/sdk/client/sse.js";

const token = process.env.TELEGRAM_TOKEN;
const apiKey = process.env.GEMINI_API_KEY;
const mcpUrl = process.env.GARMIN_MCP_URL;

if (!token || !apiKey || !mcpUrl) {
  console.error("❌ Faltan variables: TOKEN, API_KEY o URL.");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(apiKey);

async function startCoach() {
  // Usamos el namespace para llamar al constructor correctamente
  const transport = new sseSdk.SseClientTransport(new URL(mcpUrl));
  const mcpClient = new mcpSdk.Client({ name: "Coach-Edgardo", version: "1.0.0" }, { capabilities: {} });

  try {
    await mcpClient.connect(transport);
    console.log("🚀 Coach conectado a Garmin en Railway");

    const { tools } = await mcpClient.listTools();
    
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro",
      systemInstruction: "Sos el Head Coach de triatlón de Edgardo. Objetivo: Sub-11 en Cozumel. FTP: 200W. Sé técnico y motivador.",
      tools: [{ functionDeclarations: tools }]
    });

    const chat = model.startChat();

    bot.on('message', async (msg) => {
      if (!msg.text) return;
      const chatId = msg.chat.id;

      try {
        let result = await chat.sendMessage(msg.text);
        let response = result.response;

        if (response.functionCalls()) {
          const toolResults = [];
          for (const call of response.functionCalls()) {
            const toolResult = await mcpClient.callTool({
              name: call.name,
              arguments: call.args
            });
            toolResults.push({
              functionResponse: { name: call.name, response: toolResult }
            });
          }
          result = await chat.sendMessage(toolResults);
          response = result.response;
        }
        bot.sendMessage(chatId, response.text());
      } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "⚠️ Hubo un error. Seguí entrenando, yo me reinicio.");
      }
    });

  } catch (error) {
    console.error("❌ Error de conexión:", error);
    setTimeout(startCoach, 5000);
  }
}

startCoach();