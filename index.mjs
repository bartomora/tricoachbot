import { GoogleGenerativeAI } from "@google/generative-ai";
import TelegramBot from 'node-telegram-bot-api';
// Cambiamos la forma de llamar al SDK para que sea 100% compatible
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SseClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const token = process.env.TELEGRAM_TOKEN;
const apiKey = process.env.GEMINI_API_KEY;
const mcpUrl = process.env.GARMIN_MCP_URL;

if (!token || !apiKey || !mcpUrl) {
  console.error("❌ ERROR: Faltan variables en Railway.");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(apiKey);

async function startCoach() {
  console.log("🔗 Conectando a Garmin en:", mcpUrl);
  
  try {
    // Usamos el transporte SSE para hablar con tu otro servidor de Railway
    const transport = new SseClientTransport(new URL(mcpUrl));
    const mcpClient = new Client(
      { name: "Coach-Edgardo-Bot", version: "1.0.0" },
      { capabilities: {} }
    );

    await mcpClient.connect(transport);
    console.log("🚀 COACH ACTIVO: Ya puedo leer tu Garmin");

    // Traemos las herramientas del servidor de Garmin
    const { tools } = await mcpClient.listTools();
    
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro",
      systemInstruction: "Sos el Head Coach de triatlón de Edgardo. Objetivo: Sub-11 en Cozumel. FTP: 200W. Sé técnico, analítico y usá los datos de Garmin para responder.",
      tools: [{ functionDeclarations: tools }]
    });

    const chat = model.startChat();

    bot.on('message', async (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return;
      const chatId = msg.chat.id;

      try {
        let result = await chat.sendMessage(msg.text);
        let response = result.response;

        // Bucle para procesar llamadas a Garmin (pueden ser varias)
        while (response.functionCalls()?.length > 0) {
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
          // Le devolvemos los datos a Gemini para que termine su análisis
          result = await chat.sendMessage(toolResults);
          response = result.response;
        }

        bot.sendMessage(chatId, response.text());
      } catch (err) {
        console.error("Error en chat:", err);
        bot.sendMessage(chatId, "⚠️ Se me soltó la cadena. Probá preguntarme de nuevo.");
      }
    });

  } catch (error) {
    console.error("❌ Falló la conexión:", error.message);
    setTimeout(startCoach, 10000); // Reintento automático
  }
}

startCoach();
