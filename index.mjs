import { GoogleGenerativeAI } from "@google/generative-ai";
import TelegramBot from 'node-telegram-bot-api';
// Importamos los módulos completos
import * as mcpModule from "@modelcontextprotocol/sdk/client/index.js";
import * as sseModule from "@modelcontextprotocol/sdk/client/sse.js";

// --- LÓGICA DE DETECCIÓN ROBUSTA ---
// Buscamos 'Client' y 'SseClientTransport' en todas las posiciones posibles
const Client = mcpModule.Client || mcpModule.default?.Client || mcpModule.default;
const SseClientTransport = sseModule.SseClientTransport || sseModule.default?.SseClientTransport || sseModule.default;

const token = process.env.TELEGRAM_TOKEN;
const apiKey = process.env.GEMINI_API_KEY;
const mcpUrl = process.env.GARMIN_MCP_URL;

if (!token || !apiKey || !mcpUrl) {
    console.error("❌ ERROR: Faltan variables en Railway (TOKEN, API_KEY o URL).");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const genAI = new GoogleGenerativeAI(apiKey);

async function startCoach() {
    console.log("🔗 Intentando conectar a Garmin en:", mcpUrl);
    
    try {
        // Verificación de seguridad antes de intentar el 'new'
        if (typeof SseClientTransport !== 'function') {
            console.log("DEBUG - Contenido de sseModule:", Object.keys(sseModule));
            throw new Error("SseClientTransport no se cargó como un constructor. Revisá la versión del SDK.");
        }

        const transport = new SseClientTransport(new URL(mcpUrl));
        const mcpClient = new Client(
            { name: "Coach-Edgardo-Bot", version: "1.0.0" },
            { capabilities: {} }
        );

        await mcpClient.connect(transport);
        console.log("🚀 COACH EN LÍNEA: Conexión establecida con Garmin");

        const { tools } = await mcpClient.listTools();
        
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            systemInstruction: `Sos el Head Coach de triatlón de Edgardo. Objetivo: Sub-11 en Cozumel. FTP: 200W. 
            Zonas: 155W-160W. Usá los datos de Garmin para auditar HRV, sueño y entrenamientos.`,
            tools: [{ functionDeclarations: tools }]
        });

        const chat = model.startChat();

        bot.on('message', async (msg) => {
            if (!msg.text || msg.text.startsWith('/')) return;
            const chatId = msg.chat.id;

            try {
                let result = await chat.sendMessage(msg.text);
                let response = result.response;

                // Bucle de herramientas (Garmin)
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
                bot.sendMessage(chatId, "⚠️ Tuve un pequeño calambre mental. Reintentá la pregunta.");
            }
        });

    } catch (error) {
        console.error("❌ Falló la conexión:", error.message);
        // Si falla, reintentamos en 10 segundos
        setTimeout(startCoach, 10000);
    }
}

startCoach();
