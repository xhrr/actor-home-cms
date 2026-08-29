# Actor Home CMS
# 国内镜像源：docker.m.daocloud.io
FROM docker.m.daocloud.io/library/node:20-alpine

# git 用于 GitHub 部署插件推送
RUN apk add --no-cache git

WORKDIR /app

# 先装依赖，利用缓存
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# 拷贝项目代码
COPY . .

# 确保运行目录存在
RUN mkdir -p data uploads themes plugins dist

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
