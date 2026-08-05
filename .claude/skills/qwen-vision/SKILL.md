---
name: qwen-vision
description: Use the Alibaba Cloud Bailian Qwen Vision API (qwen3.7-flash) to describe images via OpenAI-compatible endpoint. Covers local image base64 encoding, prompt construction, language auto-detection, and integration with the project's fill_alt_text tool.
---

# Qwen Vision API Skill

阿里云百炼 (Bailian) Qwen 视觉理解 API — 使用 OpenAI 兼容接口，传入本地图片并获取文字描述。

本 skill 基于阿里云官方文档 [阿里云图像与视觉理解调用方法](docs/阿里云图像与视觉理解调用方法.md) 和项目中的实际集成经验整理。

---

## When to Use This Skill

Use this skill when you need to:

- **Describe a local image** — base64-encode an image file and send it to the Qwen Vision API for description.
- **Batch-process images in markdown** — use or modify the `tools/fill_alt_text.py` script to describe every image referenced in a markdown file.
- **Test API connectivity** — verify the Qwen Vision API is accessible and returns quality responses.
- **Understand the API configuration** — endpoint URL, model name, authentication, supported formats.
- **Add vision capabilities to a new tool** — copy the patterns from `tools/test_qwen_vision.py` or `tools/fill_alt_text.py`.

---

## Quick Reference

### API Configuration

| Item | Value |
|------|-------|
| Model | `qwen3.7-flash` |
| Endpoint | `https://ws-1vnm2pmv9jgzhe08.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` |
| Auth | `Authorization: Bearer <QWEN_API_KEY>` |
| API Key env var | `QWEN_API_KEY` (in `.env`) |
| Interface | OpenAI-compatible `/v1/chat/completions` |
| Image input | Base64 Data URL: `data:image/<format>;base64,<data>` |
| Supported formats | JPEG, PNG, WebP |

### Minimal Call (Python)

```python
import base64, os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(
    api_key=os.getenv("QWEN_API_KEY"),
    base_url="https://ws-1vnm2pmv9jgzhe08.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
)

# Encode local image
with open("path/to/image.jpg", "rb") as f:
    b64 = base64.b64encode(f.read()).decode("utf-8")
data_url = f"data:image/jpeg;base64,{b64}"

# Call API
completion = client.chat.completions.create(
    model="qwen3.7-flash",
    messages=[{
        "role": "user",
        "content": [
            {"type": "image_url", "image_url": {"url": data_url}},
            {"type": "text", "text": "请描述这张图片的内容。"},
        ],
    }],
)
print(completion.choices[0].message.content)
```

### Running the Project Tools

```bash
# Test API connectivity with a single image
PYTHONIOENCODING=utf-8 .venv/Scripts/python tools/test_qwen_vision.py

# Batch-process all images in a markdown file (with resume support)
PYTHONIOENCODING=utf-8 .venv/Scripts/python tools/fill_alt_text.py <path/to/doc.md>

# Preview without API calls
.venv/Scripts/python tools/fill_alt_text.py <path/to/doc.md> --dry-run

# Force language
.venv/Scripts/python tools/fill_alt_text.py <path/to/doc.md> --language cn
```

---

## Image Description Prompt

The project uses a standard English prompt with a language suffix appended automatically:

```
Describe all image attachments in this message.

If there is one image, describe it directly.
If there are multiple images:
1. Describe each image separately, preserving their order.
2. Then provide a combined description explaining the overall context
   and relationships across the images.

Return one concise factual description suitable for inserting into a
text-only chat prompt. Include visible text, objects, UI elements,
people, and relevant context. Do not invent details.
```

Language suffix (auto-detected from directory prefix):

| Directory pattern | Suffix |
|-------------------|--------|
| `CN_*` | `请用中文回答。` |
| `EN_*` | `Please respond in English.` |

---

## Language Auto-Detection

The `fill_alt_text.py` script auto-detects output language from the markdown file's parent directory:

```python
def detect_language(md_path):
    parent = os.path.basename(os.path.dirname(os.path.abspath(md_path))).upper()
    if parent.startswith("EN_"):
        return "en"
    if parent.startswith("CN_"):
        return "cn"
    return "cn"  # default
```

Override with `--language cn|en`.

---

## Image Encoding

For the OpenAI-compatible endpoint, local images must be base64-encoded into a Data URL:

```python
import base64

def encode_image(image_path):
    with open(image_path, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")
    ext = os.path.splitext(image_path)[1].lower()
    mime_map = {".jpg": "jpeg", ".jpeg": "jpeg", ".png": "png", ".webp": "webp"}
    mime = mime_map.get(ext, "jpeg")
    return f"data:image/{mime};base64,{data}"
```

> **Note:** The DashScope SDK supports `file://` paths directly (e.g., `file://D:/images/test.png`), but the OpenAI-compatible endpoint used in this project requires base64 encoding. See the [reference doc](docs/阿里云图像与视觉理解调用方法.md) for DashScope SDK alternatives.

---

## Error Handling

- **GBK encoding errors on Windows**: Use `PYTHONIOENCODING=utf-8` or handle encoding in print statements (see `test_qwen_vision.py` for the pattern).
- **Special characters in descriptions**: The `fill_alt_text.py` script escapes `[`, `]`, `"`, `&`, `<`, `>` before inserting into markdown/HTML alt text.
- **API failures**: `fill_alt_text.py` saves `[API_ERROR: ...]` as the description and continues to the next image. Failed images can be re-processed by deleting their entry from `.alt_text_progress.json`.

---

## Multi-Image Input

The API supports multiple images in a single request (used for comparison, multi-page documents, etc.):

```python
content = [
    {"type": "image_url", "image_url": {"url": data_url_1}},
    {"type": "image_url", "image_url": {"url": data_url_2}},
    {"type": "text", "text": "Compare these two images."},
]
```

> **Note:** The current `fill_alt_text.py` processes images one at a time, which is simpler and avoids token limit issues. Multi-image mode is useful for comparison scenarios.

---

## Supported Models

The project uses `qwen3.7-flash` (fast, cost-effective). Other available models:

| Model | Notes |
|-------|-------|
| `qwen3.7-flash` | Fast, default for this project |
| `qwen3.7-plus` | Higher quality, slower |
| `qwen3-vl-plus` | Vision-language model, `enable_thinking` defaults to false |
| `qwen3-vl-flash` | Fast VL model |

See [阿里云模型列表](https://help.aliyun.com/zh/model-studio/models) for the full catalog.

---

## Project Integration

Relevant project files:

| File | Purpose |
|------|---------|
| `tools/test_qwen_vision.py` | One-off API connectivity test |
| `tools/fill_alt_text.py` | Batch image description + alt text filling |
| `docs/阿里云图像与视觉理解调用方法.md` | Full Alibaba Cloud API reference |
| `.env` | Contains `QWEN_API_KEY` |
