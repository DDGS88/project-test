FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制代码
COPY parse_and_report.py web_app.py server_db.py ./
COPY login.html index.html ./
COPY name-apikey-mapping.csv ./

# 创建数据目录
RUN mkdir -p uploads reports chunks

EXPOSE 5000

# 使用 gunicorn 运行
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "--timeout", "300", "--max-requests", "1000", "--max-requests-jitter", "100", "--access-logfile", "-", "--error-logfile", "-", "web_app:app"]
