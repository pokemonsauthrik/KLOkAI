const { auth, chat, models, points, rateLimit } = require("./api");
const { groq } = require("./services");
const { log, logToFile, checkLogSize } = require("./utils");
const {
  updateStatus,
  updateUserInfo,
  updatePointsDisplay,
  updateRateLimitDisplay,
  updateModelsTable,
  render,
} = require("./ui");

// 自动化状态
let isRunning = false;
let cooldownTimer = null;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

// 账户切换状态
let accountSwitchScheduled = false;
const ACCOUNT_SWITCH_INTERVAL = 60 * 10 * 1000; // 10分钟
let accountSwitchTimer = null;
let accountSwitchCountdown = ACCOUNT_SWITCH_INTERVAL / 1000;

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

function updateStatusWithTimers() {
  if (rateLimit.isCooldownActive()) {
    const rateLimitInfo = rateLimit.getLastKnownRateLimit();
    const tokenInfo = auth.getTokenInfo();
    
    if (tokenInfo.hasMultipleTokens) {
      updateStatus(
        `冷却中: ${formatTime(rateLimitInfo.resetTime)} | 账户: ${
          tokenInfo.currentIndex + 1
        }/${tokenInfo.totalTokens}`,
        "warning"
      );
    } else {
      updateStatus(
        `冷却中: ${formatTime(rateLimitInfo.resetTime)}`,
        "warning"
      );
    }
    return;
  }

  const tokenInfo = auth.getTokenInfo();
  if (isRunning && tokenInfo.hasMultipleTokens) {
    updateStatus(
      `运行中 | 下一次切换账户: ${formatTime(
        accountSwitchCountdown
      )} | 账户: ${tokenInfo.currentIndex + 1}/${tokenInfo.totalTokens}`,
      "success"
    );
  } else if (isRunning) {
    updateStatus("运行中", "success");
  } else {
    updateStatus("已暂停", "warning");
  }

  render();
}

async function initAutomation() {
  try {
    log("正在初始化服务...", "info");
    logToFile("Initializing automation services");
    updateStatus("初始化中...", "info");
    render();

    await groq.initGroqClient();

    updateStatus("准备就绪", "success");
    render();

    return true;
  } catch (error) {
    log(`初始化错误：${error.message}`, "error");
    logToFile(`Initialization error: ${error.message}`, { error: error.stack });
    updateStatus("初始化失败", "error");
    render();
    return false;
  }
}

function scheduleAccountSwitch() {
  if (accountSwitchTimer) {
    clearTimeout(accountSwitchTimer);
    accountSwitchTimer = null;
  }

  const tokenInfo = auth.getTokenInfo();
  if (!tokenInfo.hasMultipleTokens) {
    log("只有一个账户可用，不进行账户切换", "info");
    logToFile("Account switching not scheduled - only one account available");
    return;
  }

  accountSwitchTimer = setTimeout(async () => {
    if (!isRunning) return;

    log("触发定时账户切换", "info");
    logToFile("Scheduled account switch triggered", {
      previousAccount: tokenInfo.currentIndex + 1,
      totalAccounts: tokenInfo.totalTokens,
    });

    accountSwitchScheduled = true;
    await switchAccount();
    scheduleAccountSwitch();
  }, ACCOUNT_SWITCH_INTERVAL);

  log(
    `账户切换将在 ${ACCOUNT_SWITCH_INTERVAL / 60000} 分钟后进行`,
    "info"
  );
  logToFile("Account switch scheduled", {
    intervalMinutes: ACCOUNT_SWITCH_INTERVAL / 60000,
    currentAccount: tokenInfo.currentIndex + 1,
    totalAccounts: tokenInfo.totalTokens,
  });
}

async function switchAccount() {
  try {
    log("正在切换到下一个账户...", "info");

    const success = await auth.login(true);
    if (!success) {
      throw new Error("账户切换失败");
    }

    const userInfo = await auth.getUserInfo();
    const tokenInfo = auth.getTokenInfo();
    updateUserInfo(userInfo, tokenInfo);

    const pointsData = await points.getUserPoints();
    updatePointsDisplay({
      total: pointsData.total_points,
      inference: pointsData.points.inference,
      referral: pointsData.points.referral,
    });

    const rateLimitData = await rateLimit.getRateLimit();
    updateRateLimitDisplay({
      limit: rateLimitData.limit,
      remaining: rateLimitData.remaining,
      resetTime: rateLimitData.resetTime,
      currentUsage: rateLimitData.currentUsage,
    });

    chat.createThread();

    log("账户切换成功", "success");
    logToFile("Account switch completed", {
      newAccount: tokenInfo.currentIndex + 1,
      totalAccounts: tokenInfo.totalTokens,
    });

    if (tokenInfo.hasMultipleTokens) {
      scheduleAccountSwitch();
    }

    render();
    return true;
  } catch (error) {
    log(`账户切换错误：${error.message}`, "error");
    logToFile(`Error switching account: ${error.message}`, {
      error: error.stack,
    });

    consecutiveErrors++;

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      log("多次账户切换失败，停止自动化", "error");
      isRunning = false;
      updateStatus("已停止 - 账户错误", "error");
      render();
      return false;
    }

    log("尝试下一个账户...", "warning");
    return switchAccount();
  }
}

async function startAutomation() {
  if (isRunning) {
    log("自动化已在运行中", "warning");
    return;
  }

  try {
    isRunning = true;
    consecutiveErrors = 0;
    accountSwitchScheduled = false;
    updateStatus("启动中...", "info");
    render();

    checkLogSize();

    log("开始登录...", "info");
    await auth.login();

    const userInfo = await auth.getUserInfo();
    const tokenInfo = auth.getTokenInfo();
    updateUserInfo(userInfo, tokenInfo);

    const pointsData = await points.getUserPoints();
    updatePointsDisplay({
      total: pointsData.total_points,
      inference: pointsData.points.inference,
      referral: pointsData.points.referral,
    });

    const rateLimitData = await rateLimit.getRateLimit();
    updateRateLimitDisplay({
      limit: rateLimitData.limit,
      remaining: rateLimitData.remaining,
      resetTime: rateLimitData.resetTime,
      currentUsage: rateLimitData.currentUsage,
    });

    const modelList = await models.getModels();
    updateModelsTable(modelList);

    await models.selectDefaultModel();

    chat.createThread();

    scheduleAccountSwitch();

    updateStatusWithTimers();

    automationLoop();
  } catch (error) {
    isRunning = false;
    log(`启动自动化出错：${error.message}`, "error");
    logToFile(`Error starting automation: ${error.message}`, {
      error: error.stack,
    });
    updateStatus("启动失败", "error");
    render();

    if (
      error.message.includes("socket hang up") ||
      error.message.includes("network") ||
      error.message.includes("timeout") ||
      error.message.includes("ECONNREFUSED") ||
      (error.response && error.response.status >= 500)
    ) {
      log(`将在 10 秒后尝试重新启动自动化...`, "info");
      updateStatus("10秒后自动重启...", "warning");
      render();

      setTimeout(() => {
        if (!isRunning) {
          log(`正在重新启动自动化...`, "info");
          startAutomation();
        }
      }, 10000);
    }
  }
}

async function automationLoop() {
  while (isRunning) {
    try {
      if (rateLimit.isCooldownActive()) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        updateStatusWithTimers();
        continue;
      }

      if (accountSwitchScheduled) {
        accountSwitchScheduled = false;
        await switchAccount();
        continue;
      }

      const message = await groq.generateUserMessage();
      await chat.sendMessage(message);

      const delay = Math.floor(
        Math.random() * (config.MAX_CHAT_DELAY - config.MIN_CHAT_DELAY) +
          config.MIN_CHAT_DELAY
      );
      await new Promise(resolve => setTimeout(resolve, delay));

    } catch (error) {
      log(`自动化循环出错：${error.message}`, "error");
      logToFile(`Automation loop error: ${error.message}`, {
        error: error.stack,
      });

      if (error.message.includes("rate limit")) {
        continue;
      }

      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        log("连续错误次数过多，停止自动化", "error");
        isRunning = false;
        updateStatus("已停止 - 错误过多", "error");
        render();
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

function pauseAutomation() {
  isRunning = false;
  updateStatus("已暂停", "warning");
  render();
}

function resumeAutomation() {
  if (!isRunning) {
    startAutomation();
  }
}

function getRunningState() {
  return isRunning;
}

async function manualSwitchAccount() {
  return await switchAccount();
}

module.exports = {
  initAutomation,
  startAutomation,
  pauseAutomation,
  resumeAutomation,
  manualSwitchAccount,
  getRunningState,
}; 