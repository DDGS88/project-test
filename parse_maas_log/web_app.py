"""Flask Web 应用 —— MaaS 消费明细解析服务"""

import os
import sys
import uuid
from datetime import datetime
from functools import wraps

from flask import Flask, request, jsonify, send_from_directory, session, redirect, url_for

# 确保当前目录在 sys.path 中，以便导入本地模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from parse_and_report import parse_file, aggregate, build_html, load_mapping
from server_db import (
    init_db,
    add_parse_record,
    get_parse_records,
    get_parse_record,
    delete_parse_record,
    add_upload,
    get_latest_mapping,
    get_stats,
)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "maas-parser-secret-key-change-me")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB

# 管理员账号（可通过环境变量覆盖）
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "admin123")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
REPORT_DIR = os.path.join(BASE_DIR, "reports")
CHUNK_DIR = os.path.join(BASE_DIR, "chunks")  # 分片临时目录

for d in [UPLOAD_DIR, REPORT_DIR, CHUNK_DIR]:
    os.makedirs(d, exist_ok=True)


# ── 登录装饰器 ────────────────────────────────────────────────────────
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("logged_in"):
            # API 请求返回 401，页面请求重定向到登录页
            if request.path.startswith("/api/"):
                return jsonify({"error": "未登录"}), 401
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return decorated


# ── 登录页 ────────────────────────────────────────────────────────────
@app.route("/login")
def login_page():
    if session.get("logged_in"):
        return redirect(url_for("index"))
    return send_from_directory(BASE_DIR, "login.html")


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json() or {}
    username = data.get("username", "")
    password = data.get("password", "")
    if username == ADMIN_USER and password == ADMIN_PASS:
        session["logged_in"] = True
        session["username"] = username
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": "用户名或密码错误"}), 401


@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})


# ── 页面 ──────────────────────────────────────────────────────────────
@app.route("/")
@login_required
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/reports/<path:filename>")
@login_required
def serve_report(filename):
    return send_from_directory(REPORT_DIR, filename)


@app.route("/api/download/<path:filepath>")
@login_required
def download_file(filepath):
    """下载上传的 CSV 文件，filepath 为 base64 编码的绝对路径"""
    import base64
    try:
        real_path = base64.b64decode(filepath.encode()).decode()
        if not os.path.exists(real_path):
            return jsonify({"error": "文件不存在"}), 404
        return send_from_directory(os.path.dirname(real_path), os.path.basename(real_path), as_attachment=True)
    except Exception:
        return jsonify({"error": "无效的文件路径"}), 400


# ── 分片上传 ──────────────────────────────────────────────────────────
# 使用文件存储分片元数据（兼容 gunicorn 多 worker）
import json as json_mod

CHUNK_SIZE = 5 * 1024 * 1024  # 5MB per chunk


def _chunk_meta_path(upload_id):
    return os.path.join(CHUNK_DIR, f"{upload_id}.json")


def _load_meta(upload_id):
    path = _chunk_meta_path(upload_id)
    if not os.path.exists(path):
        return None
    with open(path, "r") as f:
        return json_mod.load(f)


def _save_meta(upload_id, meta):
    with open(_chunk_meta_path(upload_id), "w") as f:
        json_mod.dump(meta, f)


@app.route("/api/upload_init", methods=["POST"])
@login_required
def api_upload_init():
    """初始化分片上传，返回 upload_id"""
    data = request.get_json() or {}
    filename = data.get("filename", "")
    file_type = data.get("file_type", "csv")  # csv or mapping
    total_chunks = data.get("total_chunks", 1)
    total_size = data.get("total_size", 0)

    if not filename:
        return jsonify({"error": "缺少文件名"}), 400
    if file_type == "csv" and not (filename.lower().endswith(".csv") or filename.lower().endswith(".xlsx")):
        return jsonify({"error": "仅支持 .csv 或 .xlsx 文件"}), 400

    upload_id = uuid.uuid4().hex
    _save_meta(upload_id, {
        "filename": filename,
        "file_type": file_type,
        "total_chunks": total_chunks,
        "total_size": total_size,
        "chunks": {},
    })
    return jsonify({"ok": True, "upload_id": upload_id})


@app.route("/api/upload_chunk", methods=["POST"])
@login_required
def api_upload_chunk():
    """接收一个分片"""
    upload_id = request.form.get("upload_id")
    chunk_index = request.form.get("chunk_index")
    chunk_file = request.files.get("chunk")

    info = _load_meta(upload_id)
    if not info:
        return jsonify({"error": "无效的 upload_id"}), 400
    if not chunk_file:
        return jsonify({"error": "缺少分片数据"}), 400

    try:
        chunk_index = int(chunk_index)
    except (TypeError, ValueError):
        return jsonify({"error": "无效的 chunk_index"}), 400

    chunk_filename = f"{upload_id}_{chunk_index:05d}"
    chunk_path = os.path.join(CHUNK_DIR, chunk_filename)
    chunk_file.save(chunk_path)
    info["chunks"][str(chunk_index)] = chunk_path
    _save_meta(upload_id, info)

    return jsonify({"ok": True, "chunk_index": chunk_index, "received": len(info["chunks"])})


@app.route("/api/upload_complete", methods=["POST"])
@login_required
def api_upload_complete():
    """合并分片，生成最终文件"""
    data = request.get_json() or {}
    upload_id = data.get("upload_id")

    info = _load_meta(upload_id)
    if not info:
        return jsonify({"error": "无效的 upload_id"}), 400

    expected = info["total_chunks"]
    received = info["chunks"]

    # 校验分片完整性
    if len(received) != expected:
        missing = sorted(set(range(expected)) - {int(k) for k in received})
        return jsonify({
            "ok": False,
            "error": f"分片不完整: 期望 {expected}, 收到 {len(received)}, 缺失索引: {missing}",
        }), 400

    # 合并文件
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    prefix = "mapping_" if info["file_type"] == "mapping" else ""
    safe_name = f"{prefix}{ts}_{info['filename']}"
    save_path = os.path.join(UPLOAD_DIR, safe_name)

    with open(save_path, "wb") as out:
        for i in range(expected):
            chunk_path = received[str(i)]
            with open(chunk_path, "rb") as inp:
                out.write(inp.read())

    final_size = os.path.getsize(save_path)

    # 清理分片和元数据
    for chunk_path in received.values():
        try:
            os.remove(chunk_path)
        except OSError:
            pass
    try:
        os.remove(_chunk_meta_path(upload_id))
    except OSError:
        pass

    # 记录到数据库
    add_upload(info["filename"], save_path, info["file_type"], final_size)

    return jsonify({
        "ok": True,
        "filename": info["filename"],
        "saved_path": save_path,
        "file_type": info["file_type"],
        "file_size": final_size,
        "message": f"{'CSV' if info['file_type'] == 'csv' else 'Mapping'} 上传成功",
    })


# ── API: 解析 CSV ─────────────────────────────────────────────────────
@app.route("/api/parse", methods=["POST"])
@login_required
def api_parse():
    data = request.get_json() or {}
    csv_path = data.get("csv_path")
    mapping_path = data.get("mapping_path")

    if not csv_path or not os.path.exists(csv_path):
        return jsonify({"error": "CSV 文件不存在，请先上传"}), 400

    csv_filename = os.path.basename(csv_path)

    # 加载 mapping
    if mapping_path and os.path.exists(mapping_path):
        mapping, resource_to_username = load_mapping(mapping_path)
        mapping_file_name = os.path.basename(mapping_path)
    else:
        # 尝试使用默认映射
        default_mapping = os.path.join(BASE_DIR, "name-apikey-mapping.csv")
        if os.path.exists(default_mapping):
            mapping, resource_to_username = load_mapping(default_mapping)
            mapping_file_name = "name-apikey-mapping.csv"
        else:
            mapping, resource_to_username = {}, {}
            mapping_file_name = ""

    # 解析
    try:
        rows = parse_file(csv_path, resource_to_username)
    except Exception as e:
        return jsonify({"error": f"文件解析失败: {str(e)}"}), 400

    if not rows:
        return jsonify({"error": "CSV 文件无有效数据"}), 400

    # 聚合
    dimensions = ["payer_user_name", "resource_id", "user_name", "product", "instance_id"]
    stats = {}
    for dim in dimensions:
        stats[dim] = aggregate(rows, dim, top_n=30, mapping=mapping)

    # 生成 HTML
    html_content = build_html(rows, stats, csv_filename)

    # 保存 HTML 报告
    base = os.path.splitext(os.path.basename(csv_path))[0]
    ts = datetime.now().strftime("%Y%m%d%H%M%S")
    html_name = f"{base}_{ts}.html"
    html_path = os.path.join(REPORT_DIR, html_name)
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    # 汇总数据
    total_records = len(rows)
    total_usage = round(sum(r["usage"] for r in rows), 2)
    total_amount = round(sum(r["amount_due"] for r in rows), 2)

    # 保存记录到数据库
    record_id = add_parse_record(
        csv_filename=os.path.basename(csv_path),
        csv_path=csv_path,
        mapping_file=mapping_file_name,
        html_filename=html_name,
        html_path=html_path,
        total_records=total_records,
        total_usage=total_usage,
        total_amount=total_amount,
    )

    return jsonify({
        "ok": True,
        "record_id": record_id,
        "html_url": f"/reports/{html_name}",
        "summary": {
            "total_records": total_records,
            "total_usage": total_usage,
            "total_amount": total_amount,
            "users": stats["payer_user_name"][0]["key"] if stats["payer_user_name"] else "",
            "products": stats["product"][0]["key"] if stats["product"] else "",
        },
    })


# ── API: 获取当前 mapping 信息 ────────────────────────────────────────
@app.route("/api/mapping_info")
@login_required
def api_mapping_info():
    path = get_latest_mapping()
    if path and os.path.exists(path):
        return jsonify({
            "ok": True,
            "filename": os.path.basename(path),
            "path": path,
        })
    return jsonify({"ok": False, "filename": None})


# ── API: 历史记录 ─────────────────────────────────────────────────────
@app.route("/api/records")
@login_required
def api_records():
    records = get_parse_records(limit=50)
    return jsonify({"ok": True, "records": records})


@app.route("/api/records/<int:record_id>", methods=["DELETE"])
@login_required
def api_delete_record(record_id):
    ok = delete_parse_record(record_id)
    return jsonify({"ok": ok})


@app.route("/api/stats")
@login_required
def api_stats():
    return jsonify({"ok": True, "stats": get_stats()})


# ── 启动 ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    init_db()
    print(f"  上传目录: {UPLOAD_DIR}")
    print(f"  报告目录: {REPORT_DIR}")
    print(f"  数据库:   {os.path.join(BASE_DIR, 'server_data.db')}")
    app.run(host="0.0.0.0", port=8899, debug=False)
