# 桌面摸鱼猫 — 好友联机鱼塘版

这是一个**零第三方依赖**的 Node.js 实时联机小游戏（无需 `npm install`），支持多人同屏钓鱼、共享鱼塘产币加成、互摸好友猫咪、实时弹幕以及专属房间邀请链接。

## 1. 本地测试（10 秒跑起来）
确保电脑装有 Node.js (v16+)，解压后在目录中运行：
```bash
node server.js
```
打开浏览器访问 `http://localhost:3000`（开两个标签页就能模拟两个好友同时联机）。

## 2. 部署到自己的服务器（VPS / 宝塔面板）
1. 将整个文件夹上传到服务器（例如 `/www/wwwroot/cat-fishing`）。
2. 用 PM2 或宝塔的「Node 项目」启动 `server.js`（默认端口 `3000`，可用环境变量 `PORT=3000` 自定义）。
3. 如果套了域名 + Nginx（含 HTTPS），在站点配置里加上 WebSocket 反向代理：
```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```
4. 部署完成后，访问 `https://你的域名/?room=moyu888` 发给朋友即可进入同一个私密鱼塘！

## 3. 免费云端一键部署（无服务器可用）
把文件夹上传到 GitHub 仓库后，在 **Render** / **Zeabur** / **Railway** 中新建 Web Service，启动命令填 `node server.js`，会自动分配 `https://` 域名并原生支持 WebSocket。
