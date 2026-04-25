import { GoogleGenerativeAI } from "@google/generative-ai";
import TelegramBot from 'node-telegram-bot-api';
import * as mcpModule from "@modelcontextprotocol/sdk/client/index.js";
import * as sseModule from "@modelcontextprotocol/sdk/client/sse.js";
// LA PIEZA QUE FALTABA:
import EventSource from "eventsource";

// Hacemos que EventSource sea global para que el SDK lo encuentre
globalThis.EventSource = EventSource;

const Client = mcpModule.Client || mcpModule.default?.Client || mcpModule.default;
const SseClientTransport = 
    sseModule.SSEClientTransport || 
    sseModule.SseClientTransport || 
    sseModule.default?.SSEClientTransport || 
    sseModule.default?.SseClientTransport || 
    sseModule.default;

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
        const transport = new SseClientTransport(new URL(mcpUrl));
        const mcpClient = new Client(
            { name: "Coach-Bot", version: "1.0.0" },
            { capabilities: {} }
        );

        await mcpClient.connect(transport);
        console.log("🚀 COACH EN LÍNEA: Conexión establecida");

        const { tools } = await mcpClient.listTools();
        
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            systemInstruction: "Sos el Head Coach de triatlón de Edgardo. Objetivo: Sub-11 en Cozumel. FTP: 200W. Sé técnico y analítico con los datos de Garmin.",
            tools: [{ functionDeclarations: tools }]
        });

        const chat = model.startChat();

        bot.on('message', async (msg) => {
            if (!msg.text || msg.text.startsWith('/')) return;
            const chatId = msg.chat.id;

            try {
                let result = await chat.sendMessage(msg.text);
                let response = result.response;

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
                    result = await chat.sendMessage(toolResults);
                    response = result.response;
                }

                bot.sendMessage(chatId, response.text());
            } catch (err) {
                console.error("Error en chat:", err);
                bot.sendMessage(chatId, "⚠️ Se me salió la cadena. Probá de nuevo.");
            }
        });

    } catch (error) {
        console.error("❌ Falló la conexión:", error.message);
        setTimeout(startCoach, 10000);
    }
}

startCoach();
