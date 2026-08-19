import time
from openai import OpenAI
import httpx

# 关闭底层重试，方便观测连接断开
http_client = httpx.Client(transport=httpx.HTTPTransport(retries=0))

client = OpenAI(
    api_key="sk-npUMbF7ywVFUQRFOSncWt95pUNHRsn94S8QRUlbhPQHup2Du",
    base_url="https://api.tokenturbo.ai/v1",
    http_client=http_client
)

print("=== 第 1 次请求：预热，建立 http 长连接 ===")
resp1 = client.chat.completions.create(
    model="claude-opus-5",
    messages=[{"role": "user", "content": "ping"}],
    stream=False,
    max_tokens=10
)
print(f"第一次返回: {resp1.choices[0].message.content}")

print("\n=== 开始空闲等待 120 秒，业务心跳保活，维持连接不被网关切断 ===")
wait_sec = 120
heartbeat_interval = 60  # 每60s发一次业务心跳，小于75s网关阈值
next_heartbeat = time.time() + heartbeat_interval

for i in range(wait_sec):
    time.sleep(1)
    now = time.time()
    # 发送轻量心跳，维持TCP活跃
    if now >= next_heartbeat:
        print(f"💓发送业务心跳，维持长连接存活")
        # 复用同一个http_client，复用现有TCP连接
        _ = http_client.get("https://api.tokenturbo.ai/v1/models")
        next_heartbeat = now + heartbeat_interval

    if (i + 1) % 20 == 0:
        print(f"已等待 {i+1} s ...")

print("\n=== 空闲 120s 结束，发起第二次请求，测试长连接是否存活 ===")
try:
    resp2 = client.chat.completions.create(
        model="claude-opus-5",
        messages=[{"role": "user", "content": "hello after idle 120s"}],
        stream=False,
        max_tokens=20
    )
    print(f"✅第二次请求成功，返回：{resp2.choices[0].message.content}")
except Exception as e:
    print(f"❌第二次请求异常：{type(e).__name__}, {e}")