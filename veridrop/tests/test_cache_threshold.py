"""CacheThresholdDetector 单元测试(假客户端,不发真实请求)。

模拟官方语义:被 cache_control 标记的前缀短于 min_cache 阈值时静默忽略
(cache_creation_input_tokens=0),达到阈值才写缓存。
"""

from __future__ import annotations

from relay_detector.protocols.anthropic.config import MODELS, lookup_model
from relay_detector.protocols.anthropic.detectors.cache_threshold import (
    ABSOLUTE_FLOOR_TOKENS,
    CacheThresholdDetector,
    _drifted,
)

USER_TOKENS = 1  # "hi"


def _tokens(text: str) -> int:
    """假分词器:一个空白分隔词 = 1 token,与填充单元 " apple" 一致。"""
    return len(text.split())


class _FakeCacheClient:
    def __init__(
        self,
        min_cache: int,
        *,
        drift: int = 0,
        count_tokens_ok: bool = True,
        fail_at_prefix: int | None = None,
    ) -> None:
        self.min_cache = min_cache
        self.drift = drift
        self.count_tokens_ok = count_tokens_ok
        self.fail_at_prefix = fail_at_prefix
        self.requests: list[tuple[int, int]] = []

    async def count_tokens(self, **body):
        if not self.count_tokens_ok:
            raise RuntimeError("count_tokens not implemented")
        text = body.get("system") or ""
        return body, {"input_tokens": _tokens(text) + USER_TOKENS}, {}, 3

    async def messages_create(self, **body):
        blocks = body.get("system") or []
        prefix = _tokens(blocks[0]["text"]) if blocks else 0
        if self.fail_at_prefix is not None and prefix == self.fail_at_prefix:
            raise RuntimeError("upstream boom")
        creation = prefix if prefix >= self.min_cache else 0
        total = prefix + USER_TOKENS + self.drift
        self.requests.append((prefix, creation))
        return (
            body,
            {
                "content": [{"type": "text", "text": "ok"}],
                "usage": {
                    "input_tokens": total - creation,
                    "cache_creation_input_tokens": creation,
                    "cache_read_input_tokens": 0,
                    "output_tokens": 1,
                },
                "stop_reason": "end_turn",
            },
            {},
            5,
        )


# --- 适用范围 --------------------------------------------------------------


def test_applies_to_known_and_unknown_models():
    detector = CacheThresholdDetector()
    assert detector.applies_to("claude-opus-4-8") is True
    assert detector.applies_to("claude-sonnet-4.6") is True
    assert detector.applies_to("gpt-4o") is False


def test_every_registered_model_has_a_cache_threshold():
    """阈值缺失会让本项静默跳过;在册模型必须都有官方值。"""
    missing = [alias for alias, info in MODELS.items() if info.min_cache_tokens <= 0]
    assert missing == []


def test_trusted_floor_never_exceeds_official_value():
    for alias, info in MODELS.items():
        floor = info.min_cache_tokens_floor or info.min_cache_tokens
        assert floor <= info.min_cache_tokens, alias


# --- 核心判定 --------------------------------------------------------------


async def test_threshold_matches_official_passes_full_score():
    """1023 不建、1024 才建 —— 官方行为,满分。"""
    client = _FakeCacheClient(lookup_model("claude-opus-4-8").min_cache_tokens)
    r = await CacheThresholdDetector().run(client, "claude-opus-4-8")

    assert r.status == "pass"
    assert r.score == 100.0
    assert r.details["evaluation"] == "threshold_matches_official"
    counted = {p["label"]: p["counted_prefix_tokens"] for p in r.details["probes"]}
    assert counted["one_token_below_official_minimum"] == 1023
    assert counted["at_official_minimum"] == 1024


async def test_creates_cache_far_below_threshold_fails():
    """256 tokens 也写缓存:官方绝无此行为(自研缓存层的典型指纹)。"""
    client = _FakeCacheClient(ABSOLUTE_FLOOR_TOKENS)
    r = await CacheThresholdDetector().run(client, "claude-opus-4-8")

    assert r.status == "fail"
    assert r.score == 0.0
    assert r.details["evaluation"] == "creates_cache_below_official_minimum"


async def test_creates_cache_one_token_below_expected_threshold():
    """1023 就建缓存 —— 若该模型阈值无争议,直接判负。"""
    official = lookup_model("claude-haiku-4-5").min_cache_tokens  # 4096,无分歧
    client = _FakeCacheClient(official - 1)
    r = await CacheThresholdDetector().run(client, "claude-haiku-4-5")

    assert r.status == "fail"
    assert r.score == 0.0
    assert r.details["evaluation"] == "creates_cache_below_official_minimum"


async def test_below_disputed_threshold_only_flags_suspect():
    """阈值来源有分歧的模型:观测值落在可信下限之上,只记疑点不判负。"""
    info = lookup_model("claude-opus-4-7")  # official 2048 / floor 1024
    assert info.min_cache_tokens_floor == 1024
    client = _FakeCacheClient(1500)
    r = await CacheThresholdDetector().run(client, "claude-opus-4-7")

    assert r.status == "pass"
    assert r.score == 80.0
    assert r.details["suspect"] is True
    assert r.details["evaluation"] == "creates_cache_below_expected_threshold"


async def test_token_drift_makes_verdict_inconclusive():
    """中转站注入 system prompt / 虚报 token 时不下结论。"""
    client = _FakeCacheClient(1024, drift=200)
    r = await CacheThresholdDetector().run(client, "claude-opus-4-8")

    assert r.status == "pass"
    assert r.score == 70.0
    assert r.details["evaluation"] == "inconclusive_token_drift"


async def test_missing_count_tokens_skips_instead_of_guessing():
    client = _FakeCacheClient(1024, count_tokens_ok=False)
    r = await CacheThresholdDetector().run(client, "claude-opus-4-8")

    assert r.status == "skip"
    assert "count_tokens" in r.details["skip_reason"]


async def test_probe_failure_at_threshold_reports_error():
    client = _FakeCacheClient(1024, fail_at_prefix=1024)
    r = await CacheThresholdDetector().run(client, "claude-opus-4-8")

    assert r.status == "error"
    assert r.score == 0.0


# --- 上探分支 --------------------------------------------------------------


async def test_threshold_above_official_escalates_and_fails():
    """1024 处没建缓存,上探到 2048 才建 —— 阈值比官方高,判负。"""
    client = _FakeCacheClient(2048)
    r = await CacheThresholdDetector().run(client, "claude-opus-4-8")

    assert r.status == "fail"
    assert r.score == 50.0
    assert r.details["evaluation"] == "threshold_above_official"


async def test_cache_never_observed_escalates_and_fails():
    """全程不写缓存 —— 该站根本没实现 prompt caching。"""
    client = _FakeCacheClient(10**9)
    r = await CacheThresholdDetector().run(client, "claude-opus-4-8")

    assert r.status == "fail"
    assert r.score == 50.0
    assert r.details["evaluation"] == "cache_not_observed_at_official_threshold"


async def test_sizing_aligns_every_probe_to_exact_target():
    client = _FakeCacheClient(2048, count_tokens_ok=True)
    r = await CacheThresholdDetector().run(client, "claude-opus-4-8")

    for probe in r.details["probes"]:
        assert probe["counted_prefix_tokens"] == probe["target_prefix_tokens"]


# --- helper ----------------------------------------------------------------


def test_drifted_uses_floor_and_relative_threshold():
    assert _drifted({"token_drift": 0, "expected_total_tokens": 1025}) is False
    assert _drifted({"token_drift": 49, "expected_total_tokens": 1025}) is False
    assert _drifted({"token_drift": 200, "expected_total_tokens": 1025}) is True
    # 长前缀时按比例放宽
    assert _drifted({"token_drift": 200, "expected_total_tokens": 10000}) is False
    # 缺字段视为不可靠
    assert _drifted({}) is True
