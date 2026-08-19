import time
from openai import OpenAI
import httpx

http_client = httpx.Client(
    transport=httpx.HTTPTransport(retries=0),
    timeout=150  # 整体请求超时，大于120s
)

client = OpenAI(
    api_key="sk-npUMbF7ywVFUQRFOSncWt95pUNHRsn94S8QRUlbhPQHup2Du",
    base_url="https://api.tokenturbo.ai/v1",
    http_client=http_client
)

print("🚀发起流式请求，开始计时")
start_time = time.time()

stream = client.chat.completions.create(
    model="claude-opus-5",
    messages=[
        {
            "role": "user",
            "content": "请输出大量内容，缓慢输出，整体输出过程尽量维持120秒，不要快速一次性输出。详细展开描述，不要省略细节。"
        }
    ],
    stream=True,
    max_tokens=4000
)

full_content = ""
chunk_count = 0

# 遍历流式分片，拼接完整结果
for chunk in stream:
    chunk_count += 1
    delta = chunk.choices[0].delta
    if delta.content:
        full_content += delta.content
        elapsed = round(time.time() - start_time, 2)
        print(f"[已耗时 {elapsed}s] chunk#{chunk_count} 收到片段: {delta.content[:30]}...")

end_time = time.time()
total_cost = round(end_time - start_time,2)

print("\n==================== 结束 ====================")
print(f"总耗时：{total_cost} 秒")
print(f"收到分片数量：{chunk_count}")
print(f"完整返回内容长度：{len(full_content)}")
print("完整结果：")
print(full_content)