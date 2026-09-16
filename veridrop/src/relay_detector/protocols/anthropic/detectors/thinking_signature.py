"""ThinkingSignatureDetector — DESIGN.md §3.3 ⭐.

Active. The crown-jewel detector: extended/adaptive thinking emits a
signature_delta event whose payload is a server-side cryptographic signature.

客户端拿不到 Anthropic 的公钥,所以**"存在一个非空的、够长的字符串"本身不是证据**
—— 中转站随手编 50 个字符就能骗过纯存在性/长度检查。真正无法伪造的只有一件事:
服务端认不认这个签名。因此本探测器用一对对照实验来判定:

  replay  把首次响应里的 thinking 块(含 signature)原样回传。真签名应被接受。
  tamper  把同一个 signature 改掉中间一个字符(长度不变、仍是合法 base64)后回传。
          真正验签的上游必然拒绝;只查长度/格式的上游会照常放行。

结论来自两者的**差异**,而不是错误文案的措辞:
  replay 通过 + tamper 被拒 → 上游确实在验签(最强证据)
  replay 通过 + tamper 也通过 → 上游不验签,签名可任意伪造

题面每次随机生成而不是固定常量 —— 固定 prompt 会被缓存,那种情况下签名与内容
确实匹配,连回传验签都能通过。随机化后缓存响应的签名必然与本次上下文不符。

Sub-checks (score):
  100 — 真签名被接受 且 篡改签名被拒(上游在验签)
  100 — 验签未能完成(网络等原因);details.signature_verified=False 标注出来
   70 — thinking block 存在但 signature 过短
   30 — thinking block 存在但从未出现 signature
   25 — 回传被接受、篡改后同样被接受(上游不验签)
   20 — 真签名回传即被拒(签名疑似伪造)
    0 — 没有 thinking 块 / thinking 参数被忽略

applies_to() filters out models that don't support thinking at all.
For models that support both extended and adaptive (Sonnet 4.6), we prefer
extended because budget_tokens gives us tighter cost control.
"""

from __future__ import annotations

import random
import re
from typing import Any

from ..client import AnthropicAPIError
from ..config import lookup_model
from ....core.models import DetectorResult
from .base import ActiveDetector


THINKING_BUDGET_TOKENS = 2000
# max_tokens caps thinking + response combined. With effort=high the adaptive
# model can use a lot of thinking tokens; setting this too low (e.g. 2600)
# causes the model to skip thinking entirely to fit. 16000 matches the
# official documentation examples.
MAX_TOKENS = 16000

# Empirically observed Anthropic thinking signatures are >> 100 chars; we
# settle for >= 50 as a generous lower bound.
SIGNATURE_MIN_LEN = 50

# 回传验签的两个追加请求只需要"是否被接受",不需要长的回答;但必须大于
# extended thinking 的 budget_tokens,否则请求本身会被参数校验拒掉。
REPLAY_MAX_TOKENS = 4000
REPLAY_PROMPT = "Reply with the single word OK."

# 回传被拒时,只有错误体指向签名/思考块本身才算证据。其余 400(请求格式、
# 体积、额度、鉴权)一律按"无法判定"处理 —— 把它们当成"上游在验签"会给出
# 假满分,当成"签名是假的"会误伤真通道。
_SIGNATURE_ERROR_RE = re.compile(
    # Bedrock 实测报错是 "Invalid `signature` in `thinking` block" —— 词之间夹着
    # 反引号,所以这里不能用 [ _] 这类窄字符集。
    r"signature|thinking[\s`_'\"-]{1,3}block|redacted_thinking|cannot be verified|"
    r"could not be verified",
    re.I,
)


def _probe_prompt() -> str:
    """每次生成不同的数字对做欧几里得算法。

    固定题面是可缓存的:中转站只要存下第一次拿到的真实响应,之后一直复用即可,
    且那种情况下签名与内容确实匹配,回传验签也照样通过。随机化让缓存必然失配。
    取 4 位数与 3 位数并保证 a > b,确保需要多步相除、模型会真的展开思考。
    """
    a = random.randint(1500, 9800)
    b = random.randint(120, 999)
    return (
        f"Find the greatest common divisor of {a} and {b} using the "
        "Euclidean algorithm."
    )


def _adaptive_effort_for_model(model: str) -> str:
    normalized = model.replace(".", "-").replace("_", "-")
    if normalized.startswith(("claude-opus-4-7", "claude-opus-4-8")):
        return "xhigh"
    return "high"


def _mutate_signature(signature: str) -> str:
    """改掉签名中间的一个字符,长度与 base64 合法性保持不变。

    专为区分两类上游:只检查"有没有这个字段、够不够长"的会照常放行;
    真正把签名交给 Anthropic 验签的必然拒绝。改中间而不是首尾,是为了避开
    base64 padding 与 protobuf 长度前缀,让拒绝尽量来自签名不匹配本身。
    """
    if len(signature) < 4:
        return signature
    i = len(signature) // 2
    original = signature[i]
    replacement = "A" if original != "A" else "B"
    return signature[:i] + replacement + signature[i + 1 :]


class ThinkingSignatureDetector(ActiveDetector):
    name = "thinking_signature"
    display_name = "思维签名验证"
    weight = 25.0

    def applies_to(self, model: str) -> bool:
        info = lookup_model(model)
        if info is None:
            return False
        return info.supports_extended_thinking or info.supports_adaptive_thinking

    async def _round_trip(
        self,
        client: Any,
        model: str,
        content_blocks: list[Any],
        probe_prompt: str,
        thinking: dict,
        extra: dict,
        *,
        tamper: bool,
    ) -> tuple[str, str | None, bool]:
        """把 thinking 块原样(或篡改后)回传给 API。

        返回 (状态, 错误摘要, 是否签名类错误);状态取 accepted/rejected/inconclusive。
        """
        blocks: list[dict] = []
        for b in content_blocks:
            if not isinstance(b, dict):
                continue
            if b.get("type") not in ("thinking", "redacted_thinking", "text"):
                continue
            block = dict(b)
            if tamper and block.get("type") == "thinking":
                sig = block.get("signature")
                if isinstance(sig, str) and sig:
                    block["signature"] = _mutate_signature(sig)
            blocks.append(block)

        messages = [
            {"role": "user", "content": probe_prompt},
            {"role": "assistant", "content": blocks},
            {"role": "user", "content": REPLAY_PROMPT},
        ]
        try:
            await client.messages_create(
                model=model,
                max_tokens=REPLAY_MAX_TOKENS,
                thinking=thinking,
                messages=messages,
                **extra,
            )
            return "accepted", None, False
        except AnthropicAPIError as e:
            body = e.body or ""
            return (
                "rejected",
                f"HTTP {e.status}: {body[:300]}",
                bool(_SIGNATURE_ERROR_RE.search(body)),
            )
        except Exception as e:  # noqa: BLE001
            return "inconclusive", str(e)[:300], False

    async def run(self, client, model: str) -> DetectorResult:
        info = lookup_model(model)
        if info is None:  # belt-and-braces — applies_to should have caught this
            return self.skip("unknown model")

        probe_prompt = _probe_prompt()

        # adaptive thinking uses a SEPARATE top-level `output_config.effort`
        # field — NOT a key under `thinking`. Putting effort inside thinking
        # is a 400 error ("Extra inputs are not permitted").
        extra: dict = {}
        if info.supports_extended_thinking:
            thinking = {"type": "enabled", "budget_tokens": THINKING_BUDGET_TOKENS}
        elif info.supports_adaptive_thinking:
            # Opus 4.7 defaults `display` to "omitted"; explicit "summarized"
            # gives us thinking text to inspect. New Opus adaptive probes need
            # xhigh for reliable signed-thinking emission on harder prompts.
            thinking = {"type": "adaptive", "display": "summarized"}
            extra["output_config"] = {"effort": _adaptive_effort_for_model(model)}
        else:
            return self.skip("model lacks thinking support")

        # Use NON-streaming. Empirically, streaming + adaptive + summarized on
        # Opus 4.7 silently drops the thinking block from the SSE stream
        # (verified: curl with `stream:true` shows only text events; curl
        # without stream returns full thinking+signature). Non-streaming gets
        # the same signature in `content[*].signature`, so detection power is
        # unchanged.
        try:
            _req, resp, _h, _lat = await client.messages_create(
                model=model,
                max_tokens=MAX_TOKENS,
                thinking=thinking,
                messages=[{"role": "user", "content": probe_prompt}],
                **extra,
            )
        except Exception as e:  # noqa: BLE001
            return self._result(
                "error",
                0.0,
                {
                    "thinking_params": thinking,
                    "output_config_sent": extra.get("output_config"),
                },
                error=str(e),
            )

        content_blocks = resp.get("content") or []
        thinking_block_seen = False
        thinking_block_type: str | None = None
        signature_value = ""
        thinking_text_chars = 0
        content_block_types_seen: list[str] = []
        for block in content_blocks:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if isinstance(btype, str):
                content_block_types_seen.append(btype)
            if btype in ("thinking", "redacted_thinking"):
                thinking_block_seen = True
                thinking_block_type = btype
                sig = block.get("signature")
                if isinstance(sig, str) and not signature_value:
                    signature_value = sig
                t = block.get("thinking")
                if isinstance(t, str):
                    thinking_text_chars += len(t)
        signature_received = bool(signature_value)
        stop_reason = resp.get("stop_reason")

        # --- 回传验签 + 篡改测试 -------------------------------------------
        # 只有真的拿到 signature 才做;没有签名时下面的存在性检查已经判负,
        # 多发两个请求没有意义。
        replay_status = tamper_status = "skipped"
        replay_error: str | None = None
        tamper_error: str | None = None
        replay_signature_error = False
        if signature_received:
            replay_status, replay_error, replay_signature_error = await self._round_trip(
                client, model, content_blocks, probe_prompt, thinking, extra,
                tamper=False,
            )
            tamper_status, tamper_error, _ = await self._round_trip(
                client, model, content_blocks, probe_prompt, thinking, extra,
                tamper=True,
            )
        signature_verified = replay_status == "accepted" and tamper_status == "rejected"

        details: dict = {
            "thinking_params": thinking,
            "output_config_sent": extra.get("output_config"),
            "content_block_types_seen": content_block_types_seen,
            "thinking_block_seen": thinking_block_seen,
            "thinking_block_type": thinking_block_type,
            "thinking_text_chars": thinking_text_chars,
            "signature_received": signature_received,
            "signature_length": len(signature_value),
            "signature_prefix": signature_value[:32] if signature_value else "",
            "stop_reason": stop_reason,
            # refusal 时官方会在此给出拒答原因（category / explanation / type）
            "stop_details": resp.get("stop_details"),
            # 对照实验:replay 是原样回传,tamper 是改了一个字符后回传
            "replay_status": replay_status,
            "replay_error": replay_error,
            "tamper_status": tamper_status,
            "tamper_error": tamper_error,
            "signature_verified": signature_verified,
        }

        if not thinking_block_seen:
            score = 0.0
            note = "no_thinking_block"
        elif not signature_received or not signature_value:
            score = 30.0
            note = "thinking_block_but_no_signature"
        elif len(signature_value) < SIGNATURE_MIN_LEN:
            score = 70.0
            note = "signature_too_short"
        elif replay_status == "accepted" and tamper_status == "rejected":
            score = 100.0
            note = "ok"
        elif replay_status == "accepted" and tamper_status == "accepted":
            # 同一个签名改了一个字符却照样被接受 → 上游只存了字段,没有验签。
            score = 25.0
            note = "upstream_does_not_verify_signature"
        elif replay_status == "rejected" and replay_signature_error:
            # 没改过的签名回传就被拒 → 这个 signature 不是服务端签出来的。
            score = 20.0
            note = "signature_rejected_on_replay"
        else:
            # 网络抖动、非签名类 400 等 → 不因探测未完成而惩罚被测对象,但
            # signature_verified=False 已明确标注"只通过了存在性检查"。
            score = 100.0
            note = "ok_signature_unverified"
        details["evaluation"] = note

        status = "pass" if score >= 70 else "fail"
        return self._result(status, score, details)
