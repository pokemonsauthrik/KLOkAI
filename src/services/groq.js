const fs = require("fs");
const path = require("path");
const axios = require("axios");
const config = require("../../config");
const { log, logToFile } = require("../utils");

let groqClient = null;

async function initGroqClient() {
  try {
    const apiKeyPath = path.resolve(config.GROQ_API_KEY_PATH);
    if (!fs.existsSync(apiKeyPath)) {
      throw new Error(`Groq API key file not found at ${apiKeyPath}`);
    }

    const apiKey = fs.readFileSync(apiKeyPath, "utf8").trim();
    if (!apiKey) {
      throw new Error("Empty Groq API key");
    }

    groqClient = axios.create({
      baseURL: "https://api.groq.com/v1",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    return true;
  } catch (error) {
    log(`Error initializing Groq client: ${error.message}`, "error");
    logToFile("Groq client initialization failed", { error: error.message });
    throw error;
  }
}

async function generateUserMessage() {
  try {
    const response = await groqClient.post("/chat/completions", {
      model: config.GROQ_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant. Generate a natural and engaging question or comment that a user might ask in a chat conversation. The message should be concise (1-2 sentences) and encourage further discussion.",
        },
      ],
      temperature: 0.7,
      max_tokens: 100,
    });

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    log(`Error generating user message: ${error.message}`, "error");
    logToFile("User message generation failed", { error: error.message });
    throw error;
  }
}

module.exports = {
  initGroqClient,
  generateUserMessage,
}; 