# 🐔 养鸡场 - 基金记录

一个简洁的基金记录展示页面。

## 功能

- 📊 展示基金买卖记录
- 📈 统计总操作次数、买入/卖出金额
- 📱 响应式设计，支持手机和电脑
- 🔄 数据自动更新（5分钟缓存）

## 使用方法

### 1. 创建 Google Sheets

1. 打开 [Google Sheets](https://sheets.google.com)
2. 新建表格，第一行输入以下字段（按顺序，一字不差）：

   | A | B | C | D | E | F | G |
   |---|---|---|---|---|---|---|
   | 日期 | 基金代码 | 基金名称 | 基金限购 | 操作 | 金额 | 备注 |

 2 行开始填写3. 从第你的数据
4. 点击「文件」→「分享」→「发布到网络」
5. 选择「整个文档」和「逗号分隔值 (.csv)」
6. 点击「发布」，复制生成的链接

### 2. 配置数据源

编辑 `app.js` 文件，将 `GOOGLE_SHEET_CSV_URL` 替换为你的 Google Sheets 发布链接：

```javascript
const GOOGLE_SHEET_CSV_URL = '你的发布链接';
```

### 3. 部署上线（免费）

#### 方式一：Vercel（推荐）

1. 安装 Vercel CLI 或注册 [Vercel](https://vercel.com)
2. 安装 Node.js
3. 在项目目录下执行：

```bash
npx vercel
```

按照提示操作，Vercel 会自动部署并提供免费域名。

#### 方式二：GitHub Pages

1. 将项目上传到 GitHub 仓库
2. 进入仓库设置 → Pages
3. 选择 main 分支，点击 Save

#### 方式三：Cloudflare Pages

1. 注册 [Cloudflare](https://pages.cloudflare.com)
2. 连接 GitHub 仓库
3. 部署分支选择 main

## 数据格式

| 字段 | 说明 | 示例 |
|------|------|------|
| 日期 | 操作日期 | 2024-01-15 |
| 基金代码 | 基金代码 | 161039 |
| 基金名称 | 基金名称 | 纳指100ETF |
| 基金限购 | 限购金额 | 1000 |
| 操作 | 买入/卖出/定投 | 买入 |
| 金额 | 交易金额 | 1000.50 |
| 备注 | 其他说明 | 日常定投 |

## 本地预览

```bash
# 方法1：直接用浏览器打开
open index.html

# 方法2：使用 Python
python -m http.server 8080
# 然后访问 http://localhost:8080

# 方法3：使用 Node.js
npx serve .
```

## 技术栈

- 原生 HTML/CSS/JavaScript
- 无需后端
- 跨域通过 AllOrigins 代理解决

## License

MIT
