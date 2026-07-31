.PHONY: all build dev clean run

APP_NAME := tt-inspector

all: build

# 开发模式 — 仅启动后端，前端单独 npm run dev
dev:
	go run ./cmd/server/ -config config/config.yaml

# 生产构建 — 前端 build + 后端编译
build:
	cd ai-gateway-console && npm install && npm run build
	go build -o $(APP_NAME) ./cmd/server/

# 运行生产版本
run: build
	./$(APP_NAME) -config config/config.yaml

# 清理
clean:
	rm -f $(APP_NAME) checkpoint.json
	rm -rf ai-gateway-console/dist

# 仅编译后端
build-server:
	go build -o $(APP_NAME) ./cmd/server/

# 仅构建前端
build-web:
	cd ai-gateway-console && npm install && npm run build
