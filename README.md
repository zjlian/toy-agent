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

## 环境变量

脚本为当前会话设置这些环境变量：
- `TOY_API_KEY`：您的 API 身份验证密钥
- `TOY_BASE_URL`：API 端点的基础 URL
- `TOY_MODEL`：用于对话的 AI 模型
- `TOY_FAST_MODEL`（可选）：某些工具（如 outline）需要的快速补充模型

## 配置管理（/config）

命令行运行后输入 `/config` 可以使用交互式向导（基于 `@inquirer/prompts`）管理多套 LLM 接入信息：

1. **新增**：设置 `BASE_URL`、`API_KEY`、`MODEL`、`FAST_MODEL`。任意字段留空则回退到环境变量。
2. **修改 / 删除**：选择已有配置进行调整或移除，删除会自动切换到其余配置或环境变量。
3. **激活**：选择某一配置生效，或切换成“仅使用环境变量”。
4. **查看**：摘要展示当前激活配置、生效字段来源以及配置文件路径。

配置优先级：

1. 当前激活的配置文件字段
2. 环境变量（`TOY_*`）

配置文件在各平台的默认位置：

- **Windows**：`%APPDATA%/toy-agent/config.json`
- **macOS**：`~/Library/Application Support/toy-agent/config.json`
- **Linux / 其他 Unix**：`${XDG_CONFIG_HOME:-~/.config}/toy-agent/config.json`

运行中修改配置会即时刷新连接的 LLM Client（无需重启 CLI）。

## 安全提示

⚠️ **重要提示**：切勿将您的实际 API 密钥提交到版本控制中。脚本仅显示您密钥的前 10 个字符用于验证目的。

- `start.ps1`、`start.sh` 被 git 忽略（在 `.gitignore` 中列出）
- 使用 `start.ps1.example` 或 `start.sh.example` 作为配置模板
- 示例文件包含占位符值，便于安全分享

---

## 内置工具（Tools）

你可以在对话中直接要求 Agent 调用工具；也可以使用 `/tools` 查看当前可用工具列表。

### outline

`outline` 用于对指定源文件生成“代码大纲”（classes/structs/functions），内部会额外发起一次 LLM 调用（语言不限定，会根据文件内容/后缀做泛化分析）。

示例（对话里直接说）：

```text
请调用 outline 工具分析 src/index.ts，并把工具输出原样返回给我。
```
