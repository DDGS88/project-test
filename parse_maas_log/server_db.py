"""SQLite 数据库操作 —— 记录上传文件与解析历史"""

import os
import sqlite3
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server_data.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS parse_records (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                csv_filename  TEXT NOT NULL,
                csv_path      TEXT NOT NULL,
                mapping_file  TEXT,
                html_filename TEXT NOT NULL,
                html_path     TEXT NOT NULL,
                total_records INTEGER DEFAULT 0,
                total_usage   REAL DEFAULT 0,
                total_amount  REAL DEFAULT 0,
                created_at    TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS uploads (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                filename  TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_type TEXT NOT NULL,   -- 'csv' or 'mapping'
                file_size INTEGER DEFAULT 0,
                uploaded_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


# ── Parse 记录 ────────────────────────────────────────────────────────
def add_parse_record(csv_filename, csv_path, mapping_file, html_filename, html_path,
                     total_records, total_usage, total_amount):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO parse_records
               (csv_filename, csv_path, mapping_file, html_filename, html_path,
                total_records, total_usage, total_amount, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (csv_filename, csv_path, mapping_file, html_filename, html_path,
             total_records, total_usage, total_amount,
             datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()
        return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def get_parse_records(limit=50):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM parse_records ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_parse_record(record_id):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM parse_records WHERE id=?", (record_id,)
        ).fetchone()
        return dict(row) if row else None


def delete_parse_record(record_id):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT csv_path, html_path FROM parse_records WHERE id=?", (record_id,)
        ).fetchone()
        if row:
            for p in [row["csv_path"], row["html_path"]]:
                if p and os.path.exists(p):
                    os.remove(p)
            conn.execute("DELETE FROM parse_records WHERE id=?", (record_id,))
            conn.commit()
            return True
    return False


# ── 上传记录 ──────────────────────────────────────────────────────────
def add_upload(filename, file_path, file_type, file_size):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO uploads (filename, file_path, file_type, file_size, uploaded_at)
               VALUES (?, ?, ?, ?, ?)""",
            (filename, file_path, file_type, file_size,
             datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        conn.commit()


def get_latest_mapping():
    """获取最近上传的 mapping 文件路径"""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT file_path FROM uploads WHERE file_type='mapping' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return row["file_path"] if row else None


# ── 统计 ──────────────────────────────────────────────────────────────
def get_stats():
    with get_conn() as conn:
        total = conn.execute("SELECT COUNT(*) as c FROM parse_records").fetchone()["c"]
        total_records = conn.execute(
            "SELECT COALESCE(SUM(total_records),0) as c FROM parse_records"
        ).fetchone()["c"]
        total_amount = conn.execute(
            "SELECT COALESCE(SUM(total_amount),0) as c FROM parse_records"
        ).fetchone()["c"]
        return {
            "total_parses": total,
            "total_records": total_records,
            "total_amount": round(total_amount, 2),
        }
