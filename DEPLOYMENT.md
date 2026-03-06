# 多人游戏部署指南（生产/测试）

最后更新：2026-03-06

## 1. 目标与前提

本项目是一个 Node.js WebSocket + 静态前端的一体化服务，默认监听容器内 `3000` 端口。  
当前服务器现状（以交接时为准）：

- `80` 已被其他 Docker 前端服务占用
- `3000` 已被其他 Docker 后端服务占用
- 建议本项目对外使用 `3001`

结论：优先使用 Docker 部署，不建议直接依赖宿主机 Node 环境。

## 2. 目录规范

建议统一放在：

```bash
/data/project/minigame-1-multiplayer
```

如无权限，先执行：

```bash
sudo mkdir -p /data/project/minigame-1-multiplayer
sudo chown -R <your_user>:<your_user> /data/project/minigame-1-multiplayer
```

## 3. 首次部署

### 3.1 拉取代码

```bash
cd /data/project
git clone https://github.com/loong-solvable/minigame-1-multiplayer.git
cd /data/project/minigame-1-multiplayer
git rev-parse HEAD
```

### 3.2 构建镜像

```bash
sudo docker build -t minigame-1-multiplayer:latest .
```

### 3.3 启动容器

```bash
sudo docker rm -f minigame-1-multiplayer 2>/dev/null || true
sudo docker run -d \
  --name minigame-1-multiplayer \
  -p 3001:3000 \
  --restart unless-stopped \
  minigame-1-multiplayer:latest
```

### 3.4 健康检查

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
curl -I http://127.0.0.1:3001
sudo docker logs --tail 100 minigame-1-multiplayer
```

## 4. 版本更新流程

```bash
cd /data/project/minigame-1-multiplayer
git pull
sudo docker build -t minigame-1-multiplayer:latest .
sudo docker rm -f minigame-1-multiplayer
sudo docker run -d \
  --name minigame-1-multiplayer \
  -p 3001:3000 \
  --restart unless-stopped \
  minigame-1-multiplayer:latest
```

更新后立即执行：

```bash
curl -I http://127.0.0.1:3001
sudo docker logs --tail 100 minigame-1-multiplayer
```

## 5. 回滚流程

建议每次发布都打镜像版本标签（不要只用 `latest`）：

```bash
sudo docker build -t minigame-1-multiplayer:2026-03-06-1 .
```

回滚示例：

```bash
sudo docker rm -f minigame-1-multiplayer
sudo docker run -d \
  --name minigame-1-multiplayer \
  -p 3001:3000 \
  --restart unless-stopped \
  minigame-1-multiplayer:2026-03-06-1
```

## 6. 云防火墙与网络

必须确认云安全组放行：

- 协议：`TCP`
- 端口：`3001`
- 来源：测试期可 `0.0.0.0/0`，上线后按需收敛

如果内网 `curl 127.0.0.1:3001` 正常但公网不可达，优先检查安全组。

## 7. 反向代理（可选）

如果后续要挂到统一域名，确保 WebSocket 升级头配置正确。Nginx 示例：

```nginx
location / {
  proxy_pass http://127.0.0.1:3001;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
}
```

注意：当前 `80` 已被其他容器占用，接入统一 Nginx 前先做全局流量改造评估。

## 8. 故障排查速查

```bash
whoami
pwd
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
sudo ss -ltnp | grep -E ':80|:443|:3000|:3001'
sudo docker logs --tail 200 minigame-1-multiplayer
```

常见问题：

- 容器起不来：看镜像是否构建成功、端口是否冲突
- 页面能开但联机失败：反代没透传 `Upgrade/Connection` 或路径错误
- 公网不可达：安全组未放行、云防火墙拦截

## 9. 上线验收标准

满足以下条件再通知测试：

- 容器状态 `Up` 且设置了 `restart unless-stopped`
- `http://<服务器IP>:3001` 打开首页正常
- 两个客户端可进入同一房间并完成一局
- 关键功能可用：房间复制、倒计时、复活 3 秒动画、加载进度遮罩
