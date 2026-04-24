import { GoogleGenerativeAI } from "@google/generative-ai";
import TelegramBot from 'node-telegram-bot-api';
// Importamos los paquetes completos para evitar errores de nombres
import * as mcpClientSdk from "@modelcontextprotocol/sdk/client/index.js";
import * as sseTransportSdk from "@modelcontextprotocol/sdk/client/sse.js";

// Extraemos las piezas con un "fallback" de seguridad
const Client = mcpClientSdk.Client || mcpClientSdk.default?.Client;
const SseClientTransport = sseTransportSdk.SseClientTransport || sseTransportSdk.default?.SseClientTransport || sseTransportSdk.default;

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
  console.log("🔗 Intentando conectar a Garmin...");
  
  try {
    // Usamos la pieza que extrajimos con seguridad
    const transport = new SseClientTransport(new URL(mcpUrl));
    const mcpClient = new Client(
      { name: "Coach-Edgardo", version: "1.0.0" },
      { capabilities: {} }
    );

    await mcpClient.connect(transport);
    console.log("🚀 COACH EN LÍNEA: Conectado a Garmin con éxito");

    const { tools } = await mcpClient.listTools();
    
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro",
      systemInstruction: "Sos el Head Coach de triatlón de Edgardo. Objetivo: Sub-11 en Cozumel. FTP: 200W. Sé técnico, analítico y motivador.",
      tools: [{ functionDeclarations: tools }]
    });

    const chat = model.startChat();

    bot.on('message', async (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return;
      const chatId = msg.chat.id;

      try {
        let result = await chat.sendMessage(msg.text);
        let response = result.response;

        if (response.functionCalls()?.length > 0) {
          const toolResults = [];
          for (const call of response.functionCalls()) {
            console.log(`📊 Consultando Garmin: ${call.name}`);
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
        console.error("Error en chat:", err);
        bot.sendMessage(chatId, "⚠️ Tuve un calambre mental. Reintentá en un segundo.");
      }
    });

  } catch (error) {
    console.error("❌ Falló la conexión:", error.message);
    setTimeout(startCoach, 10000);
  }
}

startCoach();
