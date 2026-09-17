"""Detector weights, mode-to-detector mapping, model parameter table.

Cross-references DESIGN.md §2 (weights), §6.1 (mode mapping), Appendix B (models).
"""

from __future__ import annotations

from dataclasses import dataclass

from ...core.models import Mode


# --- Weights (DESIGN.md §2) -----------------------------------------------

DETECTOR_WEIGHTS: dict[str, float] = {
    "identity": 5.0,
    "behavioral_signature": 15.0,
    "thinking_signature": 25.0,
    "consistency": 10.0,
    "knowledge": 10.0,
    "pdf": 8.0,
    "structured_output": 12.0,
    "protocol": 5.0,
    "integrity": 5.0,
    "token_usage": 10.0,
    "message_id": 5.0,
    # 官方最小可缓存长度是公开常量,且"低于阈值静默忽略"是硬语义:
    # 自研缓存层(常见于订阅逆向)往往对不齐这条边界,是难伪装的对照点。
    "cache_threshold": 8.0,
    # Heavy weight when it runs (context-window fraud is among the worst
    # lies). Skipped (0 effective weight) when ExecutionConfig.include_long_context
    # is False, so default full-mode runs stay cheap.
    "long_context": 15.0,
}


# --- Mode -> detector membership (DESIGN.md §6.1) -------------------------

MODE_DETECTORS: dict[Mode, set[str]] = {
    Mode.QUICK: {
        "identity",
        "thinking_signature",
        "consistency",
        "protocol",
        "message_id",
    },
    Mode.STANDARD: {
        "identity",
        "thinking_signature",
        "consistency",
        "knowledge",
        "structured_output",
        "protocol",
        "integrity",
        "token_usage",
        "message_id",
    },
    Mode.FULL: set(DETECTOR_WEIGHTS.keys()),
}


# --- Model parameter table (DESIGN.md Appendix B) -------------------------

@dataclass(frozen=True)
class ModelInfo:
    alias: str
    aliases: tuple[str, ...]  # accepted ID prefixes for double-prefix matching
    context_tokens: int
    max_output_tokens: int
    pdf_page_max: int
    supports_extended_thinking: bool
    supports_adaptive_thinking: bool
    new_tokenizer: bool = False
    deprecated: bool = False
    # 该模型默认就开着自适应思考(如 opus-5):不传 thinking 字段也会思考,而
    # max_tokens 是"思考 + 正文"的合计上限。探测里有大量为"只回几个字"而设的
    # 小 max_tokens 请求(token_usage 仅 16),会被思考吃空,故 client 层会为其
    # 显式补一个 thinking.type=disabled。
    thinking_on_by_default: bool = False
    # 官方最小可缓存长度(prompt caching 阈值):被 cache_control 标记的可缓存
    # 前缀短于此值时,官方静默忽略 —— 不报错、不写缓存。0 表示未知,相关探测器跳过。
    min_cache_tokens: int = 0
    # 该阈值的"可信下限"。个别模型各来源给出的值有分歧(如 opus-5 有 512 与
    # 1024 两说),低于 floor 仍写缓存才判负;落在 [floor, min_cache_tokens)
    # 只记疑点,避免拿错阈值冤枉真通道。
    min_cache_tokens_floor: int = 0


MODELS: dict[str, ModelInfo] = {
    "claude-opus-5": ModelInfo(
        alias="claude-opus-5",
        aliases=("claude-opus-5",),
        context_tokens=1_000_000,
        max_output_tokens=128_000,
        pdf_page_max=600,
        # 与 opus-4-8 同源:自适应思维(output_config.effort),不接受 extended
        # 的 thinking.budget_tokens(4.7 起传 budget_tokens 一律 400)。
        # 注意 opus-5 默认就启用 thinking:不传 thinking 字段的探测也会思考,
        # 且 max_tokens 是"思考 + 正文"的合计上限。
        supports_extended_thinking=False,
        supports_adaptive_thinking=True,
        new_tokenizer=True,
        # 官方:Opus 5 默认开启 thinking,省略 thinking 字段等于选了自适应思考。
        thinking_on_by_default=True,
        # 阈值来源有分歧:官方/第三方整理给 512 与 1024 两种说法,取前者为可信下限。
        min_cache_tokens=1024,
        min_cache_tokens_floor=512,
    ),
    "claude-opus-4-8": ModelInfo(
        alias="claude-opus-4-8",
        aliases=("claude-opus-4-8",),
        context_tokens=1_000_000,
        max_output_tokens=128_000,
        pdf_page_max=600,
        # 与前一代 opus-4-7 一致:自适应思维(output_config.effort),
        # 不走 extended(thinking.budget_tokens)。没这条 thinking_signature
        # 对 4.8 会被 applies_to() 判 False 而跳过(皇冠级检测失灵)。
        supports_extended_thinking=False,
        supports_adaptive_thinking=True,
        new_tokenizer=True,
        min_cache_tokens=1024,
    ),
    "claude-opus-4-7": ModelInfo(
        alias="claude-opus-4-7",
        aliases=("claude-opus-4-7",),
        context_tokens=1_000_000,
        max_output_tokens=128_000,
        pdf_page_max=600,
        supports_extended_thinking=False,
        supports_adaptive_thinking=True,
        new_tokenizer=True,
        # 多数来源为 2048,个别第三方整理写 1024,故下限取 1024。
        min_cache_tokens=2048,
        min_cache_tokens_floor=1024,
    ),
    "claude-sonnet-4-6": ModelInfo(
        alias="claude-sonnet-4-6",
        aliases=("claude-sonnet-4-6",),
        context_tokens=1_000_000,
        max_output_tokens=64_000,
        pdf_page_max=600,
        supports_extended_thinking=True,
        supports_adaptive_thinking=True,
        # 官方文档页面写 2048,第三方整理写 1024。
        min_cache_tokens=2048,
        min_cache_tokens_floor=1024,
    ),
    "claude-haiku-4-5": ModelInfo(
        alias="claude-haiku-4-5",
        aliases=("claude-haiku-4-5",),
        context_tokens=200_000,
        max_output_tokens=64_000,
        pdf_page_max=100,
        supports_extended_thinking=True,
        supports_adaptive_thinking=False,
        min_cache_tokens=4096,
    ),
    "claude-opus-4-6": ModelInfo(
        alias="claude-opus-4-6",
        aliases=("claude-opus-4-6",),
        context_tokens=1_000_000,
        max_output_tokens=128_000,
        pdf_page_max=600,
        supports_extended_thinking=True,
        supports_adaptive_thinking=False,
        min_cache_tokens=4096,
    ),
    "claude-sonnet-4-5": ModelInfo(
        alias="claude-sonnet-4-5",
        aliases=("claude-sonnet-4-5",),
        context_tokens=200_000,
        max_output_tokens=64_000,
        pdf_page_max=100,
        supports_extended_thinking=True,
        supports_adaptive_thinking=False,
        min_cache_tokens=1024,
    ),
    "claude-opus-4-5": ModelInfo(
        alias="claude-opus-4-5",
        aliases=("claude-opus-4-5",),
        context_tokens=200_000,
        max_output_tokens=64_000,
        pdf_page_max=100,
        supports_extended_thinking=True,
        supports_adaptive_thinking=False,
        min_cache_tokens=4096,
    ),
    "claude-opus-4-1": ModelInfo(
        alias="claude-opus-4-1",
        aliases=("claude-opus-4-1",),
        context_tokens=200_000,
        max_output_tokens=32_000,
        pdf_page_max=100,
        supports_extended_thinking=True,
        supports_adaptive_thinking=False,
        min_cache_tokens=1024,
    ),
}


def _normalize_model_id(model_id: str) -> str:
    """Canonicalize model ID separators so users typing `claude-sonnet-4.5`
    match the official `claude-sonnet-4-5` form. Without this the strict
    prefix match silently rejects the dotted form, causing thinking_signature
    and consistency to misfire on the most important Claude detector.
    """
    return model_id.replace(".", "-").replace("_", "-")


def lookup_model(model_id: str) -> ModelInfo | None:
    """Match the user-supplied model ID against known aliases (double-prefix).

    Accepts both alias (`claude-opus-4-7`) and snapshot
    (`claude-haiku-4-5-20251001`) forms, and tolerates dot-vs-hyphen
    variants (`claude-sonnet-4.5` ≡ `claude-sonnet-4-5`).
    """
    nid = _normalize_model_id(model_id)
    for info in MODELS.values():
        for alias in info.aliases:
            nalias = _normalize_model_id(alias)
            if nid.startswith(nalias) or nalias.startswith(nid):
                return info
    return None


def models_match(request_model: str, response_model: str) -> bool:
    """Bidirectional prefix match (alias <-> snapshot tolerance), with
    dot-vs-hyphen normalization."""
    if not request_model or not response_model:
        return False
    a = _normalize_model_id(request_model)
    b = _normalize_model_id(response_model)
    return b.startswith(a) or a.startswith(b)
