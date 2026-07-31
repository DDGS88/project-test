# ── tt-inspector 告警服务镜像 ──

# 阶段 1: 前端构建
FROM node:22-alpine AS web-builder
WORKDIR /web
COPY ai-gateway-console/package.json ai-gateway-console/package-lock.json ./
RUN npm install --frozen-lockfile
COPY ai-gateway-console/ ./
RUN npm run build

# 阶段 2: 后端构建
FROM golang:1.26-alpine AS go-builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web-builder /web/dist /app/ai-gateway-console/dist
RUN CGO_ENABLED=0 go build -o /tt-inspector ./cmd/server/

# 阶段 3: 运行镜像
FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Asia/Shanghai
WORKDIR /app
COPY --from=go-builder /tt-inspector .
COPY --from=go-builder /app/ai-gateway-console/dist ./ai-gateway-console/dist
COPY --from=go-builder /app/config/config.yaml ./config/config.yaml

EXPOSE 9200
CMD ["./tt-inspector", "-config", "config/config.yaml"]
