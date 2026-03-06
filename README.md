# Dino Hole Rampage Online（多人版）

这是一个基于 Node.js + WebSocket 的多人实时小游戏项目，前后端同仓，支持房间创建/加入、实时对战、控制点争夺与结算。

## 1. 快速导航

- 部署文档：`DEPLOYMENT.md`
- 游玩与测试：`PLAY_GUIDE.md`
- 服务器交接总览：`SERVER_HANDOVER.md`
- 交接执行清单：`TRANSFER_CHECKLIST.md`

## 2. 项目结构（关键文件）

- `server.js`：服务端核心逻辑
- `client/main.js`：客户端状态与交互
- `client/render.js`：客户端渲染逻辑
- `client/constants.js`：客户端常量与资源加载
- `smoke-test.js`：基础联机烟测
- `Dockerfile`：容器化部署入口

## 3. 本地启动（开发）

```bash
npm install
npm start
```

默认访问：`http://127.0.0.1:3000`

## 4. 基础测试

```bash
npm test
```

## 5. 线上部署建议

优先 Docker，避免宿主机 Node 版本差异。  
生产/测试服务器的完整上线步骤见 `DEPLOYMENT.md`。

## 6. 当前已实现的关键体验

- 顶部大号对局倒计时
- 死亡 3 秒复活大动画
- 控制点占领与炮台支援
- 复制房间码降级兼容（HTTP 也可用）
- 首局加载进度遮罩
