const fs = require("fs");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");
const config = require("../../config");
const { getAuthHeaders, executeWithRetry } = require("./auth");
const { getUserPoints } = require("./points");
const {
  log,
  logChat,
  logToFile,
  logApiRequest,
  logApiResponse,
  logApiError,
} = require("../utils");

const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");

const PROXY_FILE = "proxies.txt";

let allProxies = [];
let currentProxyIndex = 0;

function readAllProxiesFromFile() {
  try {
    if (fs.existsSync(PROXY_FILE)) {
      const fileContent = fs.readFileSync(PROXY_FILE, "utf8");
      const proxies = fileContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return proxies;
    }
    return [];
  } catch (err) {
    console.error("Error reading proxies file:", err.message);
    return [];
  }
}

function getCurrentProxy() {
  if (allProxies.length === 0) {
    allProxies = readAllProxiesFromFile();
    currentProxyIndex = 0;
  }
  if (allProxies.length === 0) {
    log("No proxies found, using machine's default IP.");
    return null;
  }
  if (currentProxyIndex >= allProxies.length) {
    currentProxyIndex = 0;
  }
  const proxyUrl = allProxies[currentProxyIndex];
  return proxyUrl;
}

function switchToNextProxy() {
  if (allProxies.length === 0) {
    allProxies = readAllProxiesFromFile();
  }
  if (allProxies.length === 0) {
    log("No proxies available to switch, using machine's default IP.");
    return null;
  }
  currentProxyIndex = (currentProxyIndex + 1) % allProxies.length;
  const proxyUrl = allProxies[currentProxyIndex];
  try {
    const parsedUrl = new URL(proxyUrl);
    log(`Switched to proxy: ${parsedUrl.hostname}`);
  } catch (err) {
    log(`Switched to proxy: ${proxyUrl}`);
  }
  return proxyUrl;
}

function getProxyAgent(targetUrl) {
  const proxyUrl = getCurrentProxy();
  if (!proxyUrl) return null;
  if (targetUrl.startsWith("https")) {
    return new HttpsProxyAgent(proxyUrl);
  } else {
    return new HttpProxyAgent(proxyUrl);
  }
}

let currentThread = null;
let selectedModel = null;

function setSelectedModel(modelName) {
  selectedModel = modelName;
  log(`Selected model: ${modelName}`, "info");
  logToFile(`Selected model: ${modelName}`);
}

function getSelectedModel() {
  return selectedModel;
}

function createThread() {
  const threadId = crypto.randomUUID();
  currentThread = {
    id: threadId,
    title: "",
    messages: [],
    created_at: new Date().toISOString(),
  };
  log(`New chat thread created: ${threadId}`, "success");
  logToFile("New chat thread created", {
    threadId: threadId,
    createdAt: currentThread.created_at,
  });
  return currentThread;
}

async function verifyPointIncrease(beforePoints) {
  try {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const pointData = await getUserPoints();
    const afterPoints = pointData.points.inference;
    const pointIncreased = afterPoints > beforePoints;
    logToFile(
      `Point verification: ${pointIncreased ? "Points increased" : "No change in points"}`,
      {
        before: beforePoints,
        after: afterPoints,
        difference: afterPoints - beforePoints,
      }
    );
    return pointIncreased;
  } catch (error) {
    logToFile(`Error verifying points: ${error.message}`, { error: error.message }, false);
    return false;
  }
}

async function sendChatMessage(content) {
  try {
    if (!selectedModel) {
      throw new Error("No model selected. Please select a model first.");
    }
    if (!currentThread) {
      createThread();
    }
    let beforePoints = 0;
    try {
      const pointData = await getUserPoints();
      beforePoints = pointData.points.inference;
      logToFile(`Points before chat: ${beforePoints}`);
    } catch (pointError) {
      logToFile(`Failed to get points before chat: ${pointError.message}`, { error: pointError.message }, false);
    }
    const userMessage = { role: "user", content };
    currentThread.messages.push(userMessage);
    logChat(content, "user");
    logToFile("Sending chat message", {
      threadId: currentThread.id,
      model: selectedModel,
      messageContent: content.substring(0, 100) + (content.length > 100 ? "..." : ""),
      messageLength: content.length,
    });
    const chatPayload = {
      id: currentThread.id,
      title: currentThread.title || "",
      language: "english",
      messages: currentThread.messages,
      model: selectedModel,
      sources: [],
    };
    log(`Sending chat message to ${selectedModel}...`, "info");
    let streamAborted = false;
    let aiResponse = "";
    const sendChatRequest = async () => {
      try {
        logApiRequest(
          "POST",
          `${config.BASE_URL}/chat`,
          chatPayload,
          { ...getAuthHeaders(), "Content-Type": "application/json" },
          true
        );
        const agent = getProxyAgent(config.BASE_URL);
        const axiosConfig = {
          headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
          responseType: "text",
          timeout: 30000,
        };
        if (agent) {
          if (config.BASE_URL.startsWith("https")) {
            axiosConfig.httpsAgent = agent;
          } else {
            axiosConfig.httpAgent = agent;
          }
        }
        const response = await axios.post(`${config.BASE_URL}/chat`, chatPayload, axiosConfig);
        logApiResponse(
          "/chat",
          {
            model: selectedModel,
            threadId: currentThread.id,
            responseStatus: response.status,
            responsePreview:
              typeof response.data === "string"
                ? response.data.substring(0, 200) + (response.data.length > 200 ? "..." : "")
                : response.data,
            responseLength: typeof response.data === "string" ? response.data.length : "N/A",
          },
          response.status,
          response.headers,
          true
        );
        return response;
      } catch (error) {
        if (error.message.includes("stream") && error.message.includes("abort")) {
          streamAborted = true;
          logToFile("Stream aborted, will verify with points", { error: error.message });
          return { data: "", status: 200, headers: {} };
        }
        throw error;
      }
    };
    let response;
    try {
      response = await executeWithRetry(sendChatRequest, `Chat to ${selectedModel}`);
    } catch (error) {
      streamAborted = true;
      logToFile(`All retries failed, will verify with points: ${error.message}`, { error: error.message });
      response = { data: "", status: 0, headers: {} };
    }
    if (streamAborted) {
      log("Verifying chat with point increase...", "warning");
      const pointVerified = await verifyPointIncrease(beforePoints);
      if (pointVerified) {
        log("Chat verified successfully through point increase!", "success");
        aiResponse = "[Response received but stream was aborted. Chat verified through point increase]";
      } else {
        throw new Error("Chat failed: Stream aborted and no point increase detected");
      }
    } else {
      if (typeof response.data === "string") {
        try {
          const dataLines = response.data.split("\n");
          for (const line of dataLines) {
            if (line.startsWith("data:")) {
              const jsonStr = line.substring(5).trim();
              const eventData = JSON.parse(jsonStr);
              if (eventData && eventData.content) {
                aiResponse = eventData.content;
                break;
              }
            }
          }
          if (!aiResponse && response.data.length > 0) {
            aiResponse = "[Response received but could not be parsed]";
          }
        } catch (parseError) {
          logToFile("Error parsing streaming response", {
            error: parseError.message,
            responsePreview: response.data.substring(0, 500),
          }, false);
          aiResponse = "[Response could not be parsed]";
        }
      }
      if (!aiResponse) {
        aiResponse = "Response received (streaming responses not fully implemented)";
      }
    }
    currentThread.messages.push({ role: "assistant", content: aiResponse });
    logChat(aiResponse, "assistant");
    logToFile("Received AI response", {
      threadId: currentThread.id,
      model: selectedModel,
      responsePreview: aiResponse.substring(0, 100) + (aiResponse.length > 100 ? "..." : ""),
      responseLength: aiResponse.length,
      streamAborted: streamAborted,
    });
    return aiResponse;
  } catch (error) {
    const errorMsg = `Error sending chat message: ${error.message}`;
    log(errorMsg, "error");
    logApiError("/chat", error);
    throw error;
  }
}

function getCurrentThread() {
  return currentThread;
}

module.exports = {
  createThread,
  sendChatMessage,
  setSelectedModel,
  getSelectedModel,
  getCurrentThread,
};
