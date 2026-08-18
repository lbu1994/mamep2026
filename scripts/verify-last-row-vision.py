"""读取 last-row-verify.png 并用 Qwen Vision API 描述，验证表格最后一行显示。"""
import base64
import os
import sys
from pathlib import Path

# 读取项目根 .env 中的 QWEN_API_KEY
REPO_ROOT = Path(__file__).resolve().parent.parent

def load_env_key():
    env_path = REPO_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("QWEN_API_KEY="):
                return line.split("=", 1)[1].strip()
    return os.getenv("QWEN_API_KEY")

api_key = load_env_key()
if not api_key:
    print("ERROR: QWEN_API_KEY not found")
    sys.exit(1)

img_path = REPO_ROOT / "_screenshots" / "last-row-verify.png"
if len(sys.argv) > 1:
    img_path = REPO_ROOT / "_screenshots" / sys.argv[1]
b64 = base64.b64encode(img_path.read_bytes()).decode("utf-8")
data_url = f"data:image/png;base64,{b64}"

from openai import OpenAI

client = OpenAI(
    api_key=api_key,
    base_url="https://ws-1vnm2pmv9jgzhe08.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
)

prompt = (
    "这是一张 Modbus 寄存器监控表格的截图，表格已滚动到最底部。"
    "请仔细检查并回答：\n"
    "1. 表格最后一行是否完整可见（没有被截断、没有被遮挡、底部边框完整）？\n"
    "2. 最后一行显示的行号是多少？是否能看到行号、状态点、Name、Register、Data 等列内容？\n"
    "3. 表格底部是否有滚动条？最后一行与表格底部边缘之间是否有空隙？是否有一行被上下裁掉一半？\n"
    "4. 描述你看到的表格整体内容（行数、列、滚动位置等）。\n"
    "请用中文回答，只描述图片中真实可见的内容，不要编造。"
)

resp = client.chat.completions.create(
    model="qwen3-vl-flash",
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": data_url}},
                {"type": "text", "text": prompt},
            ],
        }
    ],
    timeout=30,
)
print(resp.choices[0].message.content)
