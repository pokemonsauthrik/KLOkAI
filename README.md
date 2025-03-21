# KlokApp 聊天自动化

## 功能特点

- 支持多账户管理
- 私钥认证系统
- 自动代理切换
- 完整的中文界面
- 实时状态显示
- 详细的日志记录

## 安装

1. 安装 Node.js (v14+)
2. 克隆仓库：`git clone https://github.com/pokemonsauthrik/KLOkAI.git`
3. 安装依赖：`npm install`

## 配置

1. 在 `priv.txt` 中添加私钥（每行一个）
2. 在 `proxies.txt` 中添加代理（每行一个，可选）
3. 在 `groq-api.key` 中添加 Groq API 密钥

## 使用方法

1. 运行程序：`npm start`
2. 使用快捷键控制：
   - S：开始自动化
   - P：暂停
   - R：恢复
   - A：切换账户/重新认证
   - L：清理日志
   - I：显示信息
   - H：帮助
   - Q/Esc：退出

## 注意事项

- 请确保 `priv.txt` 中的私钥格式正确
- 建议使用代理以提高稳定性
- 定期检查日志文件大小