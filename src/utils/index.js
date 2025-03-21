const fs = require("fs");
const path = require("path");

const LOG_FILE = "info.log";
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

let logBox = null;

function setLogBox(box) {
  logBox = box;
}

function log(message, type = "info") {
  const timestamp = new Date().toLocaleTimeString();
  let style = "";
  switch (type) {
    case "error":
      style = "{red-fg}";
      break;
    case "success":
      style = "{green-fg}";
      break;
    case "warning":
      style = "{yellow-fg}";
      break;
    default:
      style = "{white-fg}";
  }

  if (logBox) {
    logBox.pushLine(`${style}[${timestamp}] ${message}{/}`);
    logBox.setScrollPerc(100);
  } else {
    console.log(`[${timestamp}] ${message}`);
  }
}

function logToFile(message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    message,
    ...data,
  };

  fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + "\n");
}

function logApiRequest(method, url, data, headers) {
  logToFile("API Request", {
    method,
    url,
    data,
    headers: sanitizeHeaders(headers),
  });
}

function logApiResponse(endpoint, data, status, headers) {
  logToFile("API Response", {
    endpoint,
    status,
    data,
    headers: headers ? sanitizeHeaders(headers) : undefined,
  });
}

function logApiError(error) {
  logToFile("API Error", {
    message: error.message,
    stack: error.stack,
    response: error.response
      ? {
          status: error.response.status,
          data: error.response.data,
          headers: sanitizeHeaders(error.response.headers),
        }
      : undefined,
  });
}

function sanitizeHeaders(headers) {
  const sanitized = { ...headers };
  if (sanitized["X-Session-Token"]) {
    sanitized["X-Session-Token"] = "[REDACTED]";
  }
  if (sanitized["Authorization"]) {
    sanitized["Authorization"] = "[REDACTED]";
  }
  return sanitized;
}

function checkLogSize() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size >= MAX_LOG_SIZE) {
        backupLogFile();
        clearLogFile();
      }
    }
  } catch (error) {
    console.error("Error checking log file size:", error);
  }
}

function clearLogFile() {
  try {
    fs.writeFileSync(LOG_FILE, "");
  } catch (error) {
    console.error("Error clearing log file:", error);
  }
}

function backupLogFile() {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .replace("Z", "");
      const backupPath = `${LOG_FILE}.${timestamp}.bak`;
      fs.copyFileSync(LOG_FILE, backupPath);
      return backupPath;
    }
    return null;
  } catch (error) {
    console.error("Error backing up log file:", error);
    return null;
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return null;
  }
}

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

module.exports = {
  log,
  logToFile,
  logApiRequest,
  logApiResponse,
  logApiError,
  checkLogSize,
  clearLogFile,
  backupLogFile,
  readFile,
  fileExists,
  setLogBox,
}; 