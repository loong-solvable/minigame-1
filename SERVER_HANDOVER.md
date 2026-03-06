# 服务器交接总览（给新接手同学）

最后更新：2026-03-06  
适用对象：新接手本项目的开发/运维

## 1. 本文档目的

这份文档用于让新同学在不依赖口头沟通的情况下，快速完成：

- 识别服务器现状
- 正确发布版本
- 快速定位常见故障
- 安全回滚

## 2. 已知基础环境（交接时快照）

- 公网 IP：`54.165.178.190`
- 操作系统：`CentOS 7 (Core)`
- 架构：`x86_64`
- 宿主机 Node：`v16.20.2`
- 宿主机 npm：`8.19.4`
- 宿主机 git：`1.8.3.1`

说明：宿主机环境较老，项目建议走 Docker，不建议直接宿主机跑 Node 服务。

## 3. 全局服务形态（必须先理解）

当前服务器是“多容器并行”形态，不是单宿主机 Nginx 统一入口：

- 已有业务容器占用了关键端口（如 `80`、`3000`）
- 本项目多人服务建议固定 `3001`

结论：

- 上线前先查端口，不要直接抢占 `80/3000`
- 不要在未评估前贸然改全局入口层

## 4. 本项目交付范围

项目目录建议：

```bash
/data/project/minigame-1-multiplayer
```

项目内容：

- Node.js 服务端（HTTP + WebSocket）
- 前端静态资源
- Dockerfile（可直接构建部署）
- 基础联机烟测脚本

## 5. 当前关键功能状态

已实现并应重点回归：

- 房间创建/加入/开局/结算
- 控制点占领与炮台支援
- 对局倒计时（含顶部大号计时）
- 死亡 3 秒复活大动画
- 加载进度遮罩
- 复制房间码（HTTP 环境降级兼容）

## 6. 发布标准流程（建议直接照做）

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

发布后验收：

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
curl -I http://127.0.0.1:3001
sudo docker logs --tail 100 minigame-1-multiplayer
```

## 7. 回滚标准流程

建议每次发布都保留镜像版本标签：

```bash
sudo docker build -t minigame-1-multiplayer:2026-03-06-1 .
```

故障回滚：

```bash
sudo docker rm -f minigame-1-multiplayer
sudo docker run -d \
  --name minigame-1-multiplayer \
  -p 3001:3000 \
  --restart unless-stopped \
  minigame-1-multiplayer:2026-03-06-1
```

## 8. 日常巡检命令

```bash
whoami
pwd
cat /etc/os-release
node -v
npm -v
git --version
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
sudo ss -ltnp | grep -E ':80|:443|:3000|:3001|:5432|:6379'
```

## 9. 常见故障与处理

1. 容器起不来  
先看 `docker logs`，再看端口冲突。

2. 页面可访问但联机失败  
如果走反代，检查 WebSocket 升级头是否透传。

3. 内网可访问，公网不可访问  
优先检查云安全组是否放行 `3001/tcp`。

4. 复制房间码异常  
确认前端版本为最新，已包含 Clipboard 降级方案。

## 10. 变更纪律

- 每次发布记录：时间、提交号、操作人、结果
- 先发测试再发正式
- 禁止在未确认影响面的情况下改 `80/443` 入口
- 禁止无回滚方案直接替换线上容器

## 11. 新人接手第一天建议

1. 跑一遍巡检命令，确认现网全貌  
2. 按文档完成一次“空变更重发”演练  
3. 跑一次多人联机回归（2 人 + 1 局）  
4. 验证回滚命令可执行  
5. 补齐自己的交接备注

## 12. 关联文档

- 部署细节：`DEPLOYMENT.md`
- 玩家/测试操作：`PLAY_GUIDE.md`
- 接手待办清单：`TRANSFER_CHECKLIST.md`
- 项目入口说明：`README.md`
