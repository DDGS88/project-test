# ── veridrop 中转站检测服务镜像 ──
# 只在内网被 tt-inspector 反向代理到 /veridrop 下调用，不对外暴露端口

FROM python:3.11-slim

WORKDIR /app

# 先装依赖：代码改动不会触发重装
COPY pyproject.toml README.md LICENSE ./
COPY src/ ./src/
RUN pip install --no-cache-dir -e ".[web]"

COPY web/ ./web/

# 由 tt-inspector 反代到 /veridrop，页面/JS 里渲染出的链接都要带这个前缀
ENV VERIDROP_PREFIX=/veridrop
# 检测报告落盘目录：挂载出来，容器重建后历史记录与报告不丢
ENV VERIDROP_JOBS_DIR=/app/data/jobs
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "web.server:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", \
     "--log-level", "info", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
