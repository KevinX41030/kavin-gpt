# kavin-gpt

一个仿 OpenAI 风格的多模型 AI 对话网站，前端支持切换服务与模型，后端使用 JavaScript 统一代理多个模型服务。

## 功能

- 支持多会话管理，聊天记录保存在浏览器本地
- 支持切换 OpenAI、Anthropic、Gemini、DeepSeek
- 支持自定义 OpenAI 兼容服务
- 模型名支持下拉建议，也支持手动输入
- 支持系统提示词、Temperature、Max tokens 配置

## 技术栈

- 前端：`React + TypeScript + Vite`
- 后端：`Express + JavaScript`

## 本地运行

1. 安装依赖

   ```bash
   npm install
   ```

2. 配置环境变量

   ```bash
   cp .env.example .env
   ```

   至少填入一个模型服务的 API Key。

3. 启动开发环境

   ```bash
   npm run dev
   ```

4. 打开浏览器

   前端：`http://localhost:5173`

## 生产构建

```bash
npm run build
npm run start
```

默认后端端口是 `3001`，可通过 `PORT` 修改。
图片上传请求体上限默认是 `100mb`，可通过 `REQUEST_BODY_LIMIT` 调整。

## 环境变量

参考 `.env.example`：

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `DEEPSEEK_API_KEY`
- `CUSTOM_OPENAI_API_KEY`
- `CUSTOM_OPENAI_BASE_URL`
- `CUSTOM_OPENAI_MODELS`

说明：页面里的模型输入框支持直接手输，所以如果你的模型名和示例不同，不需要改代码，只要直接输入即可。
