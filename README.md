# toy-agent

安装依赖：

```bash
bun install
```

运行：

```bash
bun run src/index.ts
```

---

# 使用指南

## 快速开始

### 方式一：使用示例模板（推荐）

1. **复制示例文件**：
   - **Windows / PowerShell**：
     ```powershell
     copy start.ps1.example start.ps1
     ```
   - **macOS / Linux / Bash**：
     ```bash
     cp start.sh.example start.sh
     ```

2. **编辑脚本**：打开 `start.ps1`（PowerShell）或 `start.sh`（Bash）并填写您的环境变量：
   - `$TOY_API_KEY`：您的 API 密钥
   - `$TOY_BASE_URL`：您的 API 基础 URL（例如：https://api.openai.com/v1）
   - `$TOY_MODEL`：您的模型名称（例如：gpt-3.5-turbo、gpt-4）

3. **运行脚本**：
   - **PowerShell**：
     ```powershell
     .\start.ps1
     ```
   - **Bash**：
     ```bash
     ./start.sh
     ```

### 方式二：直接编辑主脚本

1. **编辑主脚本**：打开 `start.ps1` 或 `start.sh` 并填写您的环境变量：
   - `$TOY_API_KEY`：您的 API 密钥
   - `$TOY_BASE_URL`：您的 API 基础 URL（例如：https://api.openai.com/v1）
   - `$TOY_MODEL`：您的模型名称（例如：gpt-3.5-turbo、gpt-4）

2. **运行脚本**：
   - **PowerShell**：
     ```powershell
     .\start.ps1
     ```
   - **Bash**：
     ```bash
     ./start.sh
     ```

3. **开始聊天**：对话循环将开始。输入您的消息并按 Enter。

4. **退出**：输入 'exit' 或 'quit' 来结束对话。

## 特性

- **上下文感知**：维护对话历史以获得更好的响应
- **错误处理**：优雅地处理 API 错误和网络问题
- **简洁界面**：简单直观的聊天界面，带有表情符号
- **内置工具**：`get_time`、`pwd`、`ls`、`read_file`、`grep`（在 CLI 中运行 `/tools` 列出）

## 环境变量

脚本为当前会话设置这些环境变量：
- `TOY_API_KEY`：您的 API 身份验证密钥
- `TOY_BASE_URL`：API 端点的基础 URL
- `TOY_MODEL`：用于对话的 AI 模型

## 安全提示

⚠️ **重要提示**：切勿将您的实际 API 密钥提交到版本控制中。脚本仅显示您密钥的前 10 个字符用于验证目的。

- `start.ps1`、`start.sh` 被 git 忽略（在 `.gitignore` 中列出）
- 使用 `start.ps1.example` 或 `start.sh.example` 作为配置模板
- 示例文件包含占位符值，便于安全分享
