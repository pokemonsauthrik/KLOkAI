const fs = require("fs");
const path = require("path");
const axios = require("axios");
const config = require("../../config");
const {
  log,
  logToFile,
  logApiRequest,
  logApiResponse,
  logApiError,
  readFile,
  fileExists,
} = require("../utils");
const pLimit = require("p-limit");

// =========== PROXY IMPORTS & GLOBALS ===========
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");

const PROXY_FILE = "proxies.txt";
let allProxies = [];
let currentProxyIndex = 0;
let persistentAgent = null;

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
 
  persistentAgent = null;
  return proxyUrl;
}

function getProxyAgent(targetUrl) {
  if (persistentAgent) return persistentAgent;
  const proxyUrl = getCurrentProxy();
  if (!proxyUrl) return null;
  if (targetUrl.startsWith("https")) {
    persistentAgent = new HttpsProxyAgent(proxyUrl);
  } else {
    persistentAgent = new HttpProxyAgent(proxyUrl);
  }
  return persistentAgent;
}
// =========== END PROXY LOGIC ===========

const SESSION_TOKEN_PATH = path.join(process.cwd(), "session-token.key");

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;
const RETRY_MULTIPLIER = 1.5;

let sessionToken = null;
let cachedUserInfo = null;

let allTokens = [];
let currentTokenIndex = 0;

// 添加私钥认证相关常量
const PRIVATE_KEY_PATH = path.join(process.cwd(), "priv.txt");
let privateKeys = [];
let currentPrivateKeyIndex = 0;

function getSessionToken() {
  return sessionToken;
}

function getTokenInfo() {
  return {
    currentIndex: currentTokenIndex,
    totalTokens: allTokens.length,
    hasMultipleTokens: allTokens.length > 1,
  };
}

function readAllSessionTokensFromFile() {
  try {
    if (fileExists(SESSION_TOKEN_PATH)) {
      const fileContent = readFile(SESSION_TOKEN_PATH);
      if (fileContent && fileContent.trim().length > 0) {
        const tokens = fileContent
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        logToFile("Read session tokens from file", {
          tokenCount: tokens.length,
          tokenPreview: tokens.map((t) => t.substring(0, 10) + "..."),
        });

        return tokens;
      }
    }
    return [];
  } catch (error) {
    logToFile("Error reading session tokens from file", {
      error: error.message,
    });
    return [];
  }
}

function readAllPrivateKeysFromFile() {
  try {
    if (fileExists(PRIVATE_KEY_PATH)) {
      const fileContent = readFile(PRIVATE_KEY_PATH);
      if (fileContent && fileContent.trim().length > 0) {
        const keys = fileContent
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        logToFile("Read private keys from file", {
          keyCount: keys.length,
        });

        return keys;
      }
    }
    return [];
  } catch (error) {
    logToFile("Error reading private keys from file", {
      error: error.message,
    });
    return [];
  }
}

function getCurrentPrivateKey() {
  if (privateKeys.length === 0) {
    privateKeys = readAllPrivateKeysFromFile();
    currentPrivateKeyIndex = 0;
  }

  if (privateKeys.length === 0) {
    return null;
  }

  return privateKeys[currentPrivateKeyIndex];
}

function switchToNextPrivateKey() {
  if (privateKeys.length === 0) {
    privateKeys = readAllPrivateKeysFromFile();
  }

  if (privateKeys.length === 0) {
    return null;
  }

  currentPrivateKeyIndex = (currentPrivateKeyIndex + 1) % privateKeys.length;
  return privateKeys[currentPrivateKeyIndex];
}

async function verifyToken(token) {
  try {
    log("Verifying token validity...", "info");
    logToFile("Verifying token validity");

    const headers = {
      ...config.DEFAULT_HEADERS,
      "X-Session-Token": token,
    };

    const verifyRequest = async () => {
      logApiRequest("GET", `${config.BASE_URL}/me`, null, headers);

      const agent = getProxyAgent(config.BASE_URL);
      const axiosConfig = {
        headers,
        timeout: 10000,
      };
      if (agent) {
        if (config.BASE_URL.startsWith("https")) {
          axiosConfig.httpsAgent = agent;
        } else {
          axiosConfig.httpAgent = agent;
        }
      }

      const response = await axios.get(`${config.BASE_URL}/me`, axiosConfig);
      logApiResponse("/me", response.data, response.status, response.headers);
      return response.status === 200;
    };

    return await executeWithRetry(verifyRequest, "Token verification");
  } catch (error) {
    log(`Token verification failed: ${error.message}`, "warning");
    logToFile("Token verification failed", { error: error.message });
    return false;
  }
}

async function verifyAndCleanupTokens() {
  try {
    log("Verifying and cleaning up tokens...", "info");
    logToFile("Starting token verification and cleanup");

    const tokens = readAllSessionTokensFromFile();

    if (tokens.length === 0) {
      log("No tokens found to verify", "warning");
      return 0;
    }

    log(`Verifying ${tokens.length} tokens...`, "info");

    // Khởi tạo p-limit để giới hạn số lượng luồng song song (có thể điều chỉnh số luồng này)
    const limit = pLimit(config.THREADS || 10); // Chạy tối đa 5 luồng song song

    // Tạo các promise để kiểm tra từng token song song
    const promises = tokens.map((token, index) =>
      limit(async () => {
        log(`Verifying token ${index + 1}/${tokens.length}...`, "info");

        const isValid = await verifyToken(token);

        if (isValid) {
          log(`Token ${index + 1}/${tokens.length} is valid`, "success");
        } else {
          log(`Token ${index + 1}/${tokens.length} is invalid or expired`, "warning");
        }
      })
    );

    // Chờ đợi tất cả các promise hoàn thành và lọc ra các token hợp lệ
    const validTokens = (await Promise.all(promises)).filter(Boolean); // Loại bỏ các null (token không hợp lệ)

    // Ghi lại các token hợp lệ vào file
    fs.writeFileSync(
      SESSION_TOKEN_PATH,
      validTokens.join("\n") + (validTokens.length > 0 ? "\n" : "")
    );

    log(
      `Token verification complete. ${validTokens.length}/${tokens.length} tokens are valid`,
      validTokens.length > 0 ? "success" : "warning"
    );
    logToFile("Token verification and cleanup completed", {
      totalTokens: tokens.length,
      validTokens: validTokens.length,
    });

    allTokens = validTokens;
    currentTokenIndex = 0;

    return validTokens.length;
  } catch (error) {
    log(`Error during token verification: ${error.message}`, "error");
    logToFile("Token verification failed", { error: error.message });
    return 0;
  }
}

function getCurrentSessionToken() {
  if (allTokens.length === 0) {
    allTokens = readAllSessionTokensFromFile();
    currentTokenIndex = 0;
  }

  if (allTokens.length === 0) {
    return null;
  }

  if (currentTokenIndex >= allTokens.length) {
    currentTokenIndex = 0;
  }

  return allTokens[currentTokenIndex];
}

function switchToNextToken() {
  if (allTokens.length === 0) {
    allTokens = readAllSessionTokensFromFile();
  }

  if (allTokens.length === 0) {
    return null;
  }

  currentTokenIndex = (currentTokenIndex + 1) % allTokens.length;
  sessionToken = allTokens[currentTokenIndex];

  log(
    `Switched to account ${currentTokenIndex + 1}/${allTokens.length}`,
    "info"
  );
  logToFile(`Switched to next token`, {
    newIndex: currentTokenIndex,
    totalTokens: allTokens.length,
    tokenPreview: sessionToken.substring(0, 10) + "...",
  });

  cachedUserInfo = null;

  return sessionToken;
}

function getAuthHeaders(headers = {}) {
  if (!sessionToken) {
    throw new Error("Not authenticated. Please login first.");
  }

  return {
    ...config.DEFAULT_HEADERS,
    ...headers,
    "X-Session-Token": sessionToken,
  };
}

async function executeWithRetry(requestFn, requestName, retryCount = 0) {
  try {
    return await requestFn();
  } catch (error) {
    const isNetworkError =
      error.message.includes("socket hang up") ||
      error.message.includes("network") ||
      error.message.includes("timeout") ||
      error.message.includes("ECONNREFUSED");

    const isServerError = error.response && error.response.status >= 500;

    const isAuthError =
      error.response &&
      (error.response.status === 401 || error.response.status === 403);

    if (isAuthError && allTokens.length > 1) {
      logToFile(
        `Auth error with current token, switching to next token`,
        {
          error: error.message,
          previousTokenIndex: currentTokenIndex,
        },
        false
      );

      switchToNextToken();

      return executeWithRetry(requestFn, `${requestName} (with new token)`, 0);
    }

    if ((isNetworkError || isServerError) && retryCount < MAX_RETRIES) {
      switchToNextProxy();
      const nextRetryCount = retryCount + 1;
      const delay = RETRY_DELAY_MS * Math.pow(RETRY_MULTIPLIER, retryCount);

      logToFile(
        `${requestName} failed (${error.message}). Retrying (${nextRetryCount}/${MAX_RETRIES}) in ${delay / 1000}s...`,
        {
          error: error.message,
          retry: nextRetryCount,
          maxRetries: MAX_RETRIES,
          delayMs: delay,
        },
        false
      );

      await new Promise((resolve) => setTimeout(resolve, delay));

      return executeWithRetry(requestFn, requestName, nextRetryCount);
    }

    throw error;
  }
}

// 修改登录函数以支持私钥认证
async function login(switchKey = false) {
  try {
    if (switchKey) {
      switchToNextPrivateKey();
    }

    const privateKey = getCurrentPrivateKey();
    if (!privateKey) {
      throw new Error("No private key available");
    }

    log("Authenticating with private key...", "info");
    logToFile("Starting private key authentication");

    const validateRequest = async () => {
      const headers = {
        ...config.DEFAULT_HEADERS,
        "X-Private-Key": privateKey,
      };

      logApiRequest("POST", `${config.BASE_URL}/auth/signin`, null, headers);

      const agent = getProxyAgent(config.BASE_URL);
      const axiosConfig = {
        headers,
        timeout: 10000,
      };
      if (agent) {
        axiosConfig.httpsAgent = agent;
      }

      const response = await axios.post(
        `${config.BASE_URL}/auth/signin`,
        null,
        axiosConfig
      );

      logApiResponse("/auth/signin", response.data, response.status);

      if (response.data && response.data.session_token) {
        sessionToken = response.data.session_token;
        // 将新的session token添加到文件中
        if (!allTokens.includes(sessionToken)) {
          allTokens.push(sessionToken);
          fs.appendFileSync(SESSION_TOKEN_PATH, sessionToken + "\n");
        }
        return true;
      }
      return false;
    };

    const success = await executeWithRetry(validateRequest, "Authentication");
    if (success) {
      log("Authentication successful", "success");
      logToFile("Authentication successful", {
        privateKeyIndex: currentPrivateKeyIndex + 1,
        totalPrivateKeys: privateKeys.length,
      });
      return true;
    }

    throw new Error("Authentication failed");
  } catch (error) {
    log(`Authentication error: ${error.message}`, "error");
    logToFile("Authentication failed", { error: error.message });

    if (privateKeys.length > 1) {
      log("Trying next private key...", "warning");
      return login(true);
    }

    return false;
  }
}

async function getUserInfo(useCache = false) {
  if (useCache && cachedUserInfo) {
    logToFile("Returning user info from cache");
    return cachedUserInfo;
  }

  try {
    log("Getting user information...", "info");
    logToFile("Getting user information");

    const headers = getAuthHeaders();

    const getUserRequest = async () => {
      logApiRequest("GET", `${config.BASE_URL}/me`, null, headers);

      const agent = getProxyAgent(config.BASE_URL);
      const requestConfig = {
        headers,
        timeout: 10000,
      };
      if (agent) {
        if (config.BASE_URL.startsWith("https")) {
          requestConfig.httpsAgent = agent;
        } else {
          requestConfig.httpAgent = agent;
        }
      }

      const response = await axios.get(`${config.BASE_URL}/me`, requestConfig);
      logApiResponse("/me", response.data, response.status, response.headers);
      return response.data;
    };

    const userData = await executeWithRetry(getUserRequest, "Get user info");
    log("User info retrieved successfully", "success");
    cachedUserInfo = userData;
    return userData;
  } catch (error) {
    const errorMsg = `Error getting user info: ${error.message}`;
    log(errorMsg, "error");
    logApiError("/me", error);
    throw error;
  }
}

async function makeApiRequest(method, endpoint, data = null, additionalHeaders = {}) {
  try {
    const headers = getAuthHeaders(additionalHeaders);
    const url = `${config.BASE_URL}${endpoint}`;

    const apiRequest = async () => {
      logApiRequest(method, url, data, headers);

      const agent = getProxyAgent(url);
      const requestConfig = {
        method,
        url,
        headers,
        timeout: 10000,
      };
      if (agent) {
        if (url.startsWith("https")) {
          requestConfig.httpsAgent = agent;
        } else {
          requestConfig.httpAgent = agent;
        }
      }
      if (data) {
        requestConfig.data = data;
      }

      const response = await axios(requestConfig);
      logApiResponse(endpoint, response.data, response.status, response.headers);
      return response.data;
    };

    return await executeWithRetry(apiRequest, `${method} ${endpoint}`);
  } catch (error) {
    const errorMsg = `API request failed (${method} ${endpoint}): ${error.message}`;
    log(errorMsg, "error");
    logApiError(endpoint, error);
    throw error;
  }
}

module.exports = {
  verifyToken,
  verifyAndCleanupTokens,
  login,
  getUserInfo,
  getSessionToken,
  getAuthHeaders,
  getCurrentSessionToken,
  getTokenInfo,
  switchToNextToken,
  makeApiRequest,
  executeWithRetry,
  readAllSessionTokensFromFile,
  readAllPrivateKeysFromFile,
  getCurrentPrivateKey,
  switchToNextPrivateKey,
};
