# Vercel部署指南 - 飞书版养鸡场

## 📦 已准备好的文件

✅ `api/feishu.js` - 飞书API代理服务
✅ `vercel.json` - Vercel配置
✅ `package.json` - 项目配置

## 🚀 部署步骤（超简单）

### 步骤1：注册Vercel账号

1. 访问：https://vercel.com
2. 点击 **Sign Up**
3. 选择 **Continue with GitHub**（推荐）或用邮箱注册
4. 完成注册

### 步骤2：安装Vercel CLI（可选，推荐用网页部署更简单）

#### 方式A：网页部署（推荐⭐⭐⭐）

1. 登录Vercel后台
2. 点击 **Add New** → **Project**
3. 选择 **Import Git Repository**
4. 连接你的GitHub仓库 `zhengyoufu666-blip/yangjichang`
5. 点击 **Deploy**
6. 等待30秒，部署完成！

#### 方式B：命令行部署

```bash
# 安装Vercel CLI
npm install -g vercel

# 在项目目录下运行
cd c:\养鸡场
vercel

# 首次运行会要求登录，按提示操作
# 选择项目配置（直接回车使用默认值）
# 部署完成后会得到一个URL，如：https://yangjichang-xxx.vercel.app
```

### 步骤3：获取API地址

部署完成后，你会得到一个URL，例如：
```
https://yangjichang-xxx.vercel.app
```

你的飞书API地址就是：
```
https://yangjichang-xxx.vercel.app/api/feishu
```

### 步骤4：修改前端代码

打开 `app.js`，找到第2-3行：

```javascript
const GOOGLE_SHEET_API_URL = 
'https://script.google.com/macros/s/AKfycbw7TMJDyFDBIM0JGU15YseYlZ-bggEW9oHNIMI1ZtiYlEIyjBq3DZJhI-zN9gKMdyOQ/exec';
```

改为：

```javascript
const FEISHU_API_URL = 
'https://你的vercel地址.vercel.app/api/feishu';
```

### 步骤5：重新部署

```bash
git add .
git commit -m "切换到飞书数据源"
git push origin main
```

## ✅ 完成！

现在你的养鸡场系统已经：
- ✅ 使用飞书多维表格作为数据源
- ✅ 通过Vercel API代理解决跨域问题
- ✅ 国内可以正常访问
- ✅ 完全免费

## 🧪 测试API

部署完成后，在浏览器访问：
```
https://你的vercel地址.vercel.app/api/feishu
```

如果看到JSON数据，说明部署成功！

## 📝 注意事项

1. **首次访问可能较慢**：Vercel的Serverless Function冷启动需要几秒钟
2. **Token会自动缓存**：避免频繁请求飞书API
3. **完全免费**：Vercel每月10万次请求额度，完全够用

## ❓ 常见问题

### Q: 部署后访问报错怎么办？
A: 检查 `api/feishu.js` 中的飞书配置是否正确

### Q: 国内访问Vercel慢怎么办？
A: Vercel在国内访问速度一般可以接受，如果实在慢可以考虑用腾讯云函数

### Q: 如何更新数据？
A: 直接在飞书多维表格中编辑数据，刷新页面即可看到最新数据

## 🔧 本地开发测试

```bash
# 安装依赖
npm install -g vercel

# 本地运行
vercel dev

# 访问 http://localhost:3000/api/feishu 测试
```

---

**有问题随时问我！** 🎉
