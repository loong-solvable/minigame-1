# 服务器交接说明

最后更新：2026-03-06  
适用对象：新接手这台服务器的程序员 / 运维

## 1. 服务器基础信息

- 公网 IP：`54.165.178.190`
- 当前登录用户示例：`dkj`
- 操作系统：`CentOS Linux 7 (Core)`
- 架构：`x86_64`

已确认信息：

- `node -v`：`v16.20.2`
- `npm -v`：`8.19.4`
- `git --version`：`1.8.3.1`

说明：

- 宿主机环境偏老，尤其是 `Node` 和 `git`
- 新项目不要默认依赖宿主机 Node 直接运行
- 优先考虑使用 `Docker` 部署，避免环境兼容问题

## 2. 全局部署策略

这台机器当前不是“宿主机统一 Nginx + 多个本地服务”的结构，而是：

- 现有前后端、数据库、缓存主要跑在 `Docker`
- Docker 对外直接占用了一部分宿主机端口
- 当前没有额外的宿主机全局 Nginx 接管所有流量

结论：

- 新服务上线前，必须先检查端口占用
- 不要想当然地去启动新的宿主机 Nginx 监听 `80/443`
- 如果现有 Docker 容器已占用端口，宿主机服务会直接冲突

## 3. 当前已知运行中的 Docker 服务

通过 `sudo docker ps` 已确认：

- `suzaku-frontend`
- `suzaku-backend`
- `suzaku-postgres`
- `suzaku-redis`
- `minigame-1-multiplayer`

## 4. 当前已知端口占用

已确认端口映射如下：

- `80` -> `suzaku-frontend`
- `3000` -> `suzaku-backend`
- `5432` -> `suzaku-postgres`
- `6379` -> `suzaku-redis`
- `3001` -> `minigame-1-multiplayer`

额外确认：

- 宿主机 `80` 当前由 Docker 的 `docker-proxy` 占用
- `3001` 当前已被多人游戏容器占用并可正常返回页面
- 当时未看到 `443` 正在监听，但这不代表未来一定没有变化，任何改动前都应重新检查

建议每次操作前先执行：

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
sudo ss -ltnp | grep -E ':80|:443|:3000|:3001|:5432|:6379'
```

## 5. 目录约定

当前多人游戏项目部署目录：

`/data/project/minigame-1-multiplayer`

说明：

- 不建议把正式项目放到用户家目录 `~`
- 当前服务器上 `/data/project` 默认属于 `root:root`
- 如果普通用户需要写入，通常要先：

```bash
sudo mkdir -p /data/project/<project-name>
sudo chown -R <user>:<user> /data/project/<project-name>
```

## 6. 当前多人游戏项目情况

项目名：

- `minigame-1-multiplayer`

GitHub 仓库：

- `https://github.com/loong-solvable/minigame-1-multiplayer`

当前部署方式：

- 通过 `Dockerfile` 构建镜像
- 通过 Docker 容器运行
- 宿主机暴露端口：`3001`
- 容器内监听端口：`3000`

容器名：

- `minigame-1-multiplayer`

镜像名：

- `minigame-1-multiplayer:latest`

对外访问方式：

- `http://54.165.178.190:3001`

## 7. 多人游戏项目的部署命令

### 拉代码

```bash
cd /data/project
git clone https://github.com/loong-solvable/minigame-1-multiplayer.git
cd /data/project/minigame-1-multiplayer
```

### 构建镜像

```bash
sudo docker build -t minigame-1-multiplayer:latest .
```

### 启动容器

```bash
sudo docker rm -f minigame-1-multiplayer 2>/dev/null || true
sudo docker run -d \
  --name minigame-1-multiplayer \
  -p 3001:3000 \
  --restart unless-stopped \
  minigame-1-multiplayer:latest
```

### 查看状态

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
sudo docker logs -f minigame-1-multiplayer
curl http://127.0.0.1:3001
```

## 8. 新人最容易踩的坑

### 1. 误以为 `80` 可用

不对。`80` 已经被现有 Docker 前端容器占用。

后果：

- 宿主机新 Nginx 起不来
- 新容器映射 `80` 会失败

### 2. 误以为 `3000` 可用

不对。`3000` 已被 `suzaku-backend` 占用。

### 3. 误以为宿主机 Node 环境适合直接跑新项目

不建议。当前宿主机 `Node 16` 偏老，容易遇到兼容问题。

建议：

- 新项目优先 Docker 化
- 除非确认兼容，否则不要直接 `npm start`

### 4. 误以为 `/data/project` 普通用户默认可写

不对。当前目录所有者是 `root:root`。

### 5. 误以为改 Nginx 就是改宿主机

不一定。当前对外 `80` 端口来自 Docker 容器，不是宿主机独立 Nginx。

处理前必须先搞清楚：

- Nginx 是跑在容器里还是宿主机
- 改动的是哪一层入口
- 会不会影响现有线上服务

## 9. 如果要接入统一域名 / Nginx

当前更安全的做法是：

1. 先让服务跑在独立端口，例如 `3001`
2. 测试通过后，再决定是否接入统一入口

有两种常见路线：

### 路线 A：继续用现有 Docker 里的 Nginx 作为总入口

适合：

- 现有网站已经稳定运行
- 不希望动宿主机网络入口

思路：

- 让多人游戏继续跑在 `3001`
- 在现有前端 Nginx 容器里增加反向代理

### 路线 B：宿主机新建统一 Nginx 接管 `80/443`

风险更高，因为：

- 现有 Docker 前端已经占用 `80`
- 迁移需要先调整旧容器端口映射
- 可能影响现有业务

在没有充分验证前，不建议贸然做

## 10. AWS 层面注意事项

即使容器和端口在服务器内正常，也不代表公网能访问。

需要同时检查 AWS Security Group 是否放行目标端口。

例如多人游戏测试期至少需要放行：

- `3001/tcp`

如果外部打不开，而服务器内部 `curl 127.0.0.1:3001` 正常，优先怀疑：

- AWS 安全组
- 云防火墙

## 11. 建议的日常检查命令

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

## 12. 交接建议

新人接手后，第一件事不是改配置，而是先确认三件事：

1. 现在有哪些容器正在跑
2. 哪些端口已经被占用
3. 新项目打算跑在宿主机还是 Docker

如果这三件事不先确认，最容易造成：

- 线上服务端口冲突
- 新服务起不来
- 错误修改入口 Nginx
- 改动影响现有业务

## 13. 本文档的局限

这份文档基于 2026-03-06 当天已观察到的实际输出整理。

可能变化的内容包括：

- Docker 容器列表
- 端口占用
- AWS 安全组
- 是否新增宿主机 Nginx
- 项目目录和发布方式

因此每次正式操作前，仍然应先执行检查命令重新确认现场状态。
