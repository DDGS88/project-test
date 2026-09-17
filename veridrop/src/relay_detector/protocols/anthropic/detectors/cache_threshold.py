"""CacheThresholdDetector — 官方最小可缓存长度(缓存阈值)真实性检测。

Anthropic 的 prompt caching 有一条硬下限:被 cache_control 标记的可缓存前缀
短于该模型的最小可缓存长度时,官方是**静默忽略** —— 不报错,也不写缓存
(cache_creation_input_tokens 恒为 0)。该阈值是每个模型固定的公开常量
(512 / 1024 / 2048 / 4096),见 config.ModelInfo.min_cache_tokens。

这正是一个难以伪装的对照点:

- 真直连通道会精确复现这条边界(1023 不建、1024 才建);
- 自研缓存层(典型如 Claude Code 订阅逆向)—— 缓存由中间件自己实现 ——
  常常"只要带 cache_control 就建缓存",下限对不齐,于是出现官方绝不可能
  出现的「1023 tokens 也建缓存」。

探测方法(请求都很小:可缓存前缀 ≤8k,max_tokens=4):

1. 绝对下限探针:把前缀精确配到 256 tokens(低于所有在用模型的最低档 512)。
   官方必然 creation=0;若 creation>0,上游缓存不是官方实现 → 0 分。
2. 卡边界对照:N-1 与 N(N = 本模型官方阈值)。N-1 就建了缓存 → 低于官方
   下限仍建缓存 → 判负(阈值表来源有分歧的模型只记疑点,见下);
   N 建了缓存 → 阈值与官方一致。
3. N 处没建缓存时再上探一档,区分「阈值比官方高」与「根本没实现缓存」。

配长用 /v1/messages/count_tokens 做**精确**对齐。用 GPT 分词器估算不行:
gpt-tokenizer 与 Claude 分词器不同代(同文本可差 30%),会把 1023 配成
1100,结论直接反转。中转站没实现 count_tokens 时本项直接 skip —— 宁可不测,
也不给假阳性。

阈值表来源有分歧的模型(如 opus-5 有 512 / 1024 两说),用
ModelInfo.min_cache_tokens_floor 记"可信下限":只有观测到低于 floor 仍建
缓存才判负;落在 [floor, official) 区间只把分数压到 80 并标注疑点,避免拿
错阈值冤枉真通道。

防伪:count_tokens 由中转站自己提供,可以谎报。每个探针都用响应自带的
usage 复核上游实际看到的前缀长度(input_tokens + cache_creation +
cache_read - 用户消息 tokens),与本地配长对不上(被注入了 system prompt
或虚报 token)时不下结论,记 inconclusive。
"""

from __future__ import annotations

import uuid
from typing import Any

from ....core.models import DetectorResult, Mode
from ..config import lookup_model
from .base import ActiveDetector


USER_MESSAGE = "hi"
PROBE_MAX_TOKENS = 4

# 低于所有在用 Claude 模型的最小可缓存长度(最低档 512),任何官方模型都
# 不会在这个长度上写缓存。
ABSOLUTE_FLOOR_TOKENS = 256

# 填充单元必须≈1 token,配长修正才能精确落在 N-1 / N 上。
FILLER_UNIT = " apple"
HEADER_TEMPLATE = (
    "Cache calibration document {nonce}. Everything after this line is "
    "padding used to reach an exact cacheable prefix length."
)

MAX_SIZING_ATTEMPTS = 6

# usage 自带 token 数与 count_tokens 的合理偏差(官方 count 端点本身也是估算)。
# 超出就说明中转站注入了额外 prompt 或虚报了 token,结论不可归因。
DRIFT_FLOOR_TOKENS = 50
DRIFT_FRAC = 0.05

# 官方在用阈值全集,用于"N 处没建缓存"时的上探。
TIER_LADDER = (512, 1024, 2048, 4096, 8192)

SCORE_OK = 100.0
SCORE_SUSPECT_BELOW_EXPECTED = 80.0
SCORE_INCONCLUSIVE = 70.0
SCORE_THRESHOLD_MISMATCH = 50.0
SCORE_ANOMALY = 0.0


class CacheThresholdDetector(ActiveDetector):
    name = "cache_threshold"
    display_name = "缓存阈值真实性"
    weight = 8.0
    modes = {Mode.FULL}

    def applies_to(self, model: str) -> bool:
        info = lookup_model(model)
        return info is not None and info.min_cache_tokens > 0

    async def run(self, client, model: str) -> DetectorResult:
        info = lookup_model(model)
        if info is None or info.min_cache_tokens <= 0:
            return self.skip("unknown model or missing official cache threshold")

        official = info.min_cache_tokens
        floor = info.min_cache_tokens_floor or official

        # 用户消息本身的 token 数,用来把"可缓存前缀"从"总 input"里分离出来。
        user_tokens = await self._request_token_count(client, model, None)
        if user_tokens is None:
            return self.skip(
                "count_tokens 不可用,无法精确对齐缓存阈值"
                "(拒绝用 GPT 分词器估算,避免假阳性)"
            )

        probes: list[dict[str, Any]] = []
        details: dict[str, Any] = {
            "official_min_cache_tokens": official,
            "trusted_floor_tokens": floor,
            "user_message_tokens": user_tokens,
            "absolute_floor_probe_tokens": ABSOLUTE_FLOOR_TOKENS,
            "probes": probes,
        }

        # --- 1) 绝对下限探针:任何官方模型都不该在这个长度写缓存 -------
        probes.append(
            await self._probe(
                client,
                model,
                ABSOLUTE_FLOOR_TOKENS,
                user_tokens,
                "below_any_official_minimum",
            )
        )

        # --- 2) 卡边界对照:N-1 与 N -----------------------------------
        probes.append(
            await self._probe(
                client, model, official - 1, user_tokens,
                "one_token_below_official_minimum",
            )
        )
        probes.append(
            await self._probe(
                client, model, official, user_tokens, "at_official_minimum"
            )
        )

        below = _find_probe(probes, "one_token_below_official_minimum")
        at = _find_probe(probes, "at_official_minimum")

        # 低于官方阈值却写缓存 —— 官方绝无此行为。
        offenders = [
            p
            for p in probes
            if p.get("cache_created") and p["target_prefix_tokens"] < official
        ]
        reliable_offenders = [p for p in offenders if not _drifted(p)]
        if reliable_offenders:
            worst = min(reliable_offenders, key=lambda p: p["target_prefix_tokens"])
            if worst["target_prefix_tokens"] < floor:
                details["evaluation"] = "creates_cache_below_official_minimum"
                return self._result("fail", SCORE_ANOMALY, details)
            # 阈值表本身有分歧的模型:观测值落在可信下限之上,只记疑点。
            details["evaluation"] = "creates_cache_below_expected_threshold"
            details["suspect"] = True
            return self._result("pass", SCORE_SUSPECT_BELOW_EXPECTED, details)

        if at is None or at.get("error"):
            return self._result(
                "error",
                0.0,
                details,
                error=str(at.get("error") if at else "at_official_minimum probe missing"),
            )

        if at.get("cache_created"):
            # 有探针在低阈值处"写缓存但 token 数对不上"时,无法排除是注入的
            # system prompt 把前缀顶过了阈值 —— 不下结论。
            if _drifted(at) or any(p.get("cache_created") for p in offenders):
                details["evaluation"] = "inconclusive_token_drift"
                return self._result("pass", SCORE_INCONCLUSIVE, details)
            details["evaluation"] = "threshold_matches_official"
            return self._result("pass", SCORE_OK, details)

        # --- 3) N 处没写缓存:上探一档,区分"阈值更高"与"未实现缓存" ----
        escalation = next((t for t in TIER_LADDER if t > official), None)
        above = None
        if escalation is not None:
            above = await self._probe(
                client, model, escalation, user_tokens, "above_official_minimum"
            )
            probes.append(above)
        if above is not None and _reliable_creation(above):
            details["evaluation"] = "threshold_above_official"
        else:
            details["evaluation"] = "cache_not_observed_at_official_threshold"
        return self._result("fail", SCORE_THRESHOLD_MISMATCH, details)

    # --- internals ---------------------------------------------------

    async def _probe(
        self,
        client,
        model: str,
        target_prefix_tokens: int,
        user_tokens: int,
        label: str,
    ) -> dict[str, Any]:
        """把可缓存前缀精确配到 target,带 cache_control 发一次请求。"""
        nonce = uuid.uuid4().hex[:8]
        text, counted_prefix, sizing_attempts = await self._size_prefix(
            client, model, target_prefix_tokens, user_tokens, nonce
        )
        probe: dict[str, Any] = {
            "label": label,
            "target_prefix_tokens": target_prefix_tokens,
            "counted_prefix_tokens": counted_prefix,
            "sizing_attempts": sizing_attempts,
        }
        if counted_prefix is None:
            probe["error"] = "count_tokens failed while sizing the cacheable prefix"
            return probe

        try:
            _req, resp, _h, _lat = await client.messages_create(
                model=model,
                max_tokens=PROBE_MAX_TOKENS,
                temperature=0,
                # 显式 breakpoint:cache_control 标在 system 内容块上(官方语义,
                # 标在请求体顶层是"自动缓存",语义不同)。
                system=[
                    {
                        "type": "text",
                        "text": text,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=[{"role": "user", "content": USER_MESSAGE}],
            )
        except Exception as e:  # noqa: BLE001
            probe["error"] = str(e)
            return probe

        usage = resp.get("usage") if isinstance(resp, dict) else None
        usage = usage if isinstance(usage, dict) else {}
        input_tokens = _int(usage.get("input_tokens")) or 0
        creation = _int(usage.get("cache_creation_input_tokens")) or 0
        read = _int(usage.get("cache_read_input_tokens")) or 0
        # 官方语义:input_tokens 不含命中/写入的缓存部分,三者相加才是总前缀。
        observed_total = input_tokens + creation + read
        expected_total = counted_prefix + user_tokens
        probe.update(
            {
                "input_tokens": input_tokens,
                "cache_creation_input_tokens": creation,
                "cache_read_input_tokens": read,
                "expected_total_tokens": expected_total,
                "observed_total_tokens": observed_total,
                "observed_prefix_tokens": observed_total - user_tokens,
                "token_drift": observed_total - expected_total,
                "cache_created": creation > 0,
                "stop_reason": resp.get("stop_reason") if isinstance(resp, dict) else None,
            }
        )
        return probe

    async def _size_prefix(
        self,
        client,
        model: str,
        target_prefix_tokens: int,
        user_tokens: int,
        nonce: str,
    ) -> tuple[str, int | None, int]:
        """逐步修正填充长度,直到 count_tokens 报出的前置 token 数正好是 target。

        返回 (文本, 实测前缀 token 数, 迭代次数);count 端点失败时实测值为 None。
        """
        units = max(0, target_prefix_tokens)
        text = _build_text(nonce, units)
        counted_prefix: int | None = None
        for attempt in range(1, MAX_SIZING_ATTEMPTS + 1):
            counted_total = await self._request_token_count(client, model, text)
            if counted_total is None:
                return text, None, attempt
            counted_prefix = counted_total - user_tokens
            if counted_prefix == target_prefix_tokens:
                return text, counted_prefix, attempt
            # 每个填充单元≈1 token,差值直接当作单元数修正。
            units = max(0, units + (target_prefix_tokens - counted_prefix))
            text = _build_text(nonce, units)
        return text, counted_prefix, MAX_SIZING_ATTEMPTS

    async def _request_token_count(
        self, client, model: str, system_text: str | None
    ) -> int | None:
        body: dict[str, Any] = {
            "model": model,
            "messages": [{"role": "user", "content": USER_MESSAGE}],
        }
        if system_text:
            body["system"] = system_text
        try:
            _req, resp, _h, _lat = await client.count_tokens(**body)
        except Exception:  # noqa: BLE001 — 端点缺失/限流一律按不可用处理
            return None
        value = resp.get("input_tokens") if isinstance(resp, dict) else None
        return value if isinstance(value, int) and not isinstance(value, bool) else None


def _build_text(nonce: str, units: int) -> str:
    return HEADER_TEMPLATE.format(nonce=nonce) + FILLER_UNIT * max(0, units)


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _find_probe(probes: list[dict[str, Any]], label: str) -> dict[str, Any] | None:
    return next((p for p in probes if p.get("label") == label), None)


def _drifted(probe: dict[str, Any]) -> bool:
    """响应自带的 token 数与本地配长对不上 → 前缀长度不可归因。"""
    drift = probe.get("token_drift")
    expected = probe.get("expected_total_tokens")
    if not isinstance(drift, int) or not isinstance(expected, int):
        return True
    return drift > max(DRIFT_FLOOR_TOKENS, int(expected * DRIFT_FRAC))


def _reliable_creation(probe: dict[str, Any]) -> bool:
    return bool(probe.get("cache_created")) and not _drifted(probe)
