const fs = require("fs");
const path = require("path");
const { authenticateAllWallets } = require("./src/api/signin");
const {
  initDashboard,
  registerKeyHandler,
  render,
  updateStatus,
  widgets,
} = require("./src/ui");
const {
  initAutomation,
  startAutomation,
  pauseAutomation,
  resumeAutomation,
  manualSwitchAccount,
  getRunningState,
} = require("./src/automation");
const { auth } = require("./src/api");
const {
  log,
  logToFile,
  checkLogSize,
  clearLogFile,
  backupLogFile,
} = require("./src/utils");

function readPrivateKeysFromFile(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File ${absolutePath} not exits.`);
    return [];
  }
  const data = fs.readFileSync(absolutePath, "utf8");
  return data.split(/\r?\n/).filter(line => line.trim() !== "");
}

function clearSessionTokenFile() {
  const tokenPath = path.join(process.cwd(), "session-token.key");
  
  fs.writeFileSync(tokenPath, "", "utf8");
  console.log("[INFO] session-token.key has been cleared.");
}

async function main() {
  try {
    checkLogSize();

    initDashboard();

    log("欢迎使用 KlokApp 聊天自动化系统", "info");
    log("按 S 开始, P 暂停, R 恢复, H 查看帮助", "info");
    logToFile("KlokApp Chat Automation started");

    const privateKeys = auth.readAllPrivateKeysFromFile();
    if (privateKeys.length === 0) {
      log("未在 priv.txt 文件中找到私钥", "error");
      updateStatus("缺少私钥文件 priv.txt", "error");
      render();
      return;
    }

    log(`找到 ${privateKeys.length} 个私钥，正在认证...`, "info");
    updateStatus("认证中...", "info");
    render();

    const success = await auth.login();
    if (success) {
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

      log("认证成功！准备开始。", "success");
      updateStatus("准备就绪，按 S 开始", "success");
    } else {
      log("认证失败，请检查私钥。", "error");
      updateStatus("认证失败", "error");
    }

    render();

    await initAutomation();

    registerKeyHandler("s", async () => {
      if (!getRunningState()) {
        const tokens = auth.readAllSessionTokensFromFile();
        if (tokens.length === 0) {
          log("未找到会话令牌，请添加 session-token.key 文件", "error");
          updateStatus("缺少 session-token.key", "error");
          render();
          return;
        }

        const isValid = await auth.verifyToken(tokens[0]);
        if (!isValid) {
          log("会话令牌已过期，需要重新认证", "error");
          updateStatus("令牌过期，按 'A' 重新认证", "error");
          render();
          return;
        }

        log("正在启动自动化...", "info");
        logToFile("Starting automation (user initiated)");
        startAutomation();
      } else {
        log("自动化已在运行中", "warning");
        logToFile("Start request ignored - automation already running");
      }
    });

    registerKeyHandler("p", () => {
      if (getRunningState()) {
        log("正在暂停自动化...", "info");
        logToFile("Pausing automation (user initiated)");
        pauseAutomation();
      } else {
        log("自动化未在运行", "warning");
        logToFile("Pause request ignored - automation not running");
      }
    });

    registerKeyHandler("r", () => {
      if (!getRunningState()) {
        log("正在恢复自动化...", "info");
        logToFile("Resuming automation (user initiated)");
        resumeAutomation();
      } else {
        log("自动化已在运行中", "warning");
        logToFile("Resume request ignored - automation already running");
      }
    });

    registerKeyHandler("a", async () => {
      const tokenInfo = auth.getTokenInfo();
      if (getRunningState()) {
        log("正在手动切换账户...", "info");
        logToFile("Manual account switch initiated");

        const success = await manualSwitchAccount();
        if (success) {
          log("账户切换成功", "success");
        } else {
          log("账户切换失败", "error");
        }
      } else {
        if (tokenInfo.hasMultipleTokens) {
          log("只有一个账户可用，无法切换", "warning");
          return;
        }

        log("正在重新认证账户...", "info");
        logToFile("Re-authentication initiated");
        updateStatus("重新认证中...", "info");
        render();

        const privateKeys = readPrivateKeysFromFile("priv.txt");
        if (privateKeys.length === 0) {
          log("未在 priv.txt 文件中找到私钥", "error");
          updateStatus("缺少私钥文件 priv.txt", "error");
        } else {
          await authenticateAllWallets(privateKeys);
          const tokens = auth.readAllSessionTokensFromFile();
          if (tokens.length > 0) {
            log(`重新认证成功！${tokens.length} 个账户已就绪`, "success");
            updateStatus(`${tokens.length} 个账户就绪，按 S 开始`, "success");
          } else {
            log("重新认证失败，未收到有效令牌", "error");
            updateStatus("重新认证失败", "error");
          }
        }
      }
    });

    registerKeyHandler("l", () => {
      const backupPath = backupLogFile();
      clearLogFile();
      if (backupPath) {
        log(`日志文件已清理并备份至 ${backupPath}`, "success");
        logToFile("Log file cleared and backed up (user initiated)");
      } else {
        log("日志文件已清理", "success");
        logToFile("Log file cleared (user initiated)");
      }
      render();
    });

    registerKeyHandler("i", () => {
      const fs = require("fs");
      const path = require("path");

      try {
        const logPath = path.join(process.cwd(), "info.log");
        if (fs.existsSync(logPath)) {
          const stats = fs.statSync(logPath);
          const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
          const lastModified = new Date(stats.mtime).toLocaleString();

          log(`日志文件：大小=${fileSizeMB}MB，最后修改时间：${lastModified}`, "info");
        } else {
          log("日志文件尚未创建", "info");
        }
      } catch (error) {
        log(`读取日志信息出错：${error.message}`, "error");
      }

      try {
        const tokens = auth.readAllSessionTokensFromFile();
        const tokenInfo = auth.getTokenInfo();

        if (tokens.length === 0) {
          log("未找到账户", "warning");
        } else if (tokens.length === 1) {
          log("已配置 1 个账户", "info");
        } else {
          log(
            `已配置 ${tokens.length} 个账户，当前：${tokenInfo.currentIndex + 1}/${
              tokenInfo.totalTokens
            }`,
            "info"
          );
        }
      } catch (error) {
        log(`检查账户时出错：${error.message}`, "error");
      }

      updateStatus("信息已显示", "info");

      setTimeout(() => {
        updateStatus(
          getRunningState() ? "运行中" : "就绪",
          getRunningState() ? "success" : "info"
        );
        render();
      }, 5000);

      render();
    });

    registerKeyHandler("h", () => {
      log("控制说明：", "info");
      log("S - 开始自动化（需要至少一个会话令牌）", "info");
      log("P - 暂停自动化", "info");
      log("R - 恢复自动化", "info");
      log("A - 运行时：切换到下一个账户；停止时：重新认证", "info");
      log("L - 清理日志文件并备份", "info");
      log("I - 显示文件和账户信息", "info");
      log("H - 显示此帮助", "info");
      log("Q 或 Esc - 退出程序", "info");

      updateStatus("帮助 - 按任意键继续", "info");
      render();

      setTimeout(() => {
        updateStatus(
          getRunningState() ? "运行中" : "就绪",
          getRunningState() ? "success" : "info"
        );
        render();
      }, 8000);
    });
  } catch (error) {
    log(`启动错误：${error.message}`, "error");
    logToFile(`Startup error: ${error.message}`, { error: error.stack });
    updateStatus("启动失败", "error");
    render();
  }
}

main();