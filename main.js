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

      log("认证成功！准备开始。", "success");
      updateStatus("准备就绪，按 S 开始", "success");
    } else {
      log("认证失败，请检查私钥。", "error");
      updateStatus("认证失败", "error");
    }

    render();
    await initAutomation();
  } catch (error) {
    log(`启动错误：${error.message}`, "error");
    logToFile(`Startup error: ${error.message}`, { error: error.stack });
    updateStatus("启动失败", "error");
    render();
  }
}

main().catch(console.error);