import { GoogleGenerativeAI } from "@google/generative-ai";
import TelegramBot from 'node-telegram-bot-api';
// Cambiamos la ruta de importación para que sea compatible con la versión actual del SDK
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
    
    // Forzamos la creación del transporte con la URL de Railway
    const transport = new SseClientTransport(new URL(mcpUrl));
    const mcpClient = new Client(
        { name: "Coach-Edgardo-Bot", version: "1.0.0" },
        { capabilities: {} }
    );

    try {
        await mcpClient.connect(transport);
        console.log("🚀 COACH ACTIVO: Conexión establecida con Garmin");

        const { tools } = await mcpClient.listTools();
        
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro",
            systemInstruction: "Sos el Head Coach de triatlón de Edgardo. Objetivo: Sub-11 en Cozumel. FTP: 200W. Sé técnico y usá Garmin para auditar vatios y recuperación.",
            tools: [{ functionDeclarations: tools }]
        });

        const chat = model.startChat();

        bot.on('message', async (msg) => {
            if (!msg.text || msg.text.startsWith('/')) return;
            const chatId = msg.chat.id;

            try {
                let result = await chat.sendMessage(msg.text);
                let response = result.response;

                // Procesamos las herramientas de Garmin
                if (response.functionCalls()?.length > 0) {
                    const toolResults = [];
                    for (const call of response.functionCalls()) {
                        console.log(`📊 Consultando Garmin: ${call.name}`);
                        const toolResult = await mcpClient.callTool({
                            name: call.name,
                            arguments: call.args
                        });
                        
                        toolResults.push({
                            functionResponse: {
                                name: call.name,
                                response: toolResult
                            }
                        });
                    }
                    // Devolvemos los datos a Gemini
                    result = await chat.sendMessage(toolResults);
                    response = result.response;
                }

                bot.sendMessage(chatId, response.text());
            } catch (err) {
                console.error("Error en chat:", err);
                bot.sendMessage(chatId, "⚠️ Se me salió la cadena. Intentá de nuevo.");
            }
        });

    } catch (error) {
        console.error("❌ Falló la conexión:", error.message);
        setTimeout(startCoach, 10000);
    }
}

startCoach();
