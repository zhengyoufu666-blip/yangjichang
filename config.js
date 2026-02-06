// 配置说明
// 
// 1. 打开你的 Google Sheets
// 2. 点击「文件」→「分享」→「发布到网络」
// 3. 选择「整个文档」和「逗号分隔的值 (.csv)」
// 4. 点击「发布」按钮
// 5. 复制生成的链接，替换下方的 URL
//
// 链接格式类似：https://docs.google.com/spreadsheets/d/e/2PACX-xxxxx/pub?output=csv

// 注意：当前系统使用的是 Google Apps Script API，不是直接的 CSV URL
// 如果你需要切换到直接 CSV 模式，请修改 app.js 中的 GOOGLE_SHEET_API_URL

const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1xxxxxxxxxxxxx/pub?output=csv';