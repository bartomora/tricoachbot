import { GoogleGenerativeAI } from "@google/generative-ai";
import TelegramBot from 'node-telegram-bot-api';
// Importación directa de las piezas del puzzle
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SseClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const token = process.env.TELEGRAM_TOKEN;
const apiKey = process.env.GEMINI_API_KEY;
const mcpUrl = process.env.GARMIN_MCP_URL;

if (!token || !apiKey || !mcpUrl) {
  console.error("❌ ERROR: Faltan variables en Railway.");
  process.exit(1);
}

// Configuración del Bot y la IA
const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(apiKey);

async function startCoach() {
  console.log("🔗 Intentando conectar a Garmin en:", mcpUrl);
  
  try {
    // Aquí es donde el Named Import (SseClientTransport) evita el error de "constructor"
    const transport = new SseClientTransport(new URL(mcpUrl));
    const mcpClient = new Client(
      { name: "Coach-Edgardo-Bot", version: "1.0.0" },
      { capabilities: {} }
    );

    await mcpClient.connect(transport);
    console.log("🚀 COACH EN LÍNEA: Conectado a Garmin con éxito");

    const { tools } = await mcpClient.listTools();
    
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro",
      systemInstruction: `Sos el Head Coach de Edgardo. Objetivo: Sub-11 en Cozumel. FTP: 200W. 
      Zonas: 155W-160W. Usá los datos de Garmin para auditar HRV y entrenamientos.`,
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
    // Reintento en 10 segundos si el servidor MCP no responde
    setTimeout(startCoach, 10000);
  }
}

startCoach();
