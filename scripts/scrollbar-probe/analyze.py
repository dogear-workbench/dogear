import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("NO_PIL")
    sys.exit(0)

import numpy as np

base = Path(__file__).parent
# thumb 常显淡色预期: #B8AE99 35% 叠 #f5f2ea 背景 ≈ (224,218,206)；hover 预期 #9A9080 ≈ (154,144,128)
for name in ["shot1-idle", "shot2-center", "shot3-on-thumb", "shot4-outside"]:
    img = Image.open(base / f"{name}.png").convert("RGB")
    arr = np.array(img)
    h, w = arr.shape[:2]
    scale = w / 900
    x0, x1 = int(250 * scale), int(260 * scale)
    y0, y1 = int(120 * scale), int(480 * scale)
    region = arr[y0:y1, x0:x1].reshape(-1, 3).astype(int)
    bg = np.array([245, 242, 234])
    dist = np.abs(region - bg).sum(axis=1)
    hit = region[dist > 20]
    if len(hit):
        print(f"{name}: thumb 色像素={len(hit)} 均色={tuple(hit.mean(axis=0).astype(int))} 最深={tuple(hit[hit.sum(axis=1).argmin()])}")
    else:
        print(f"{name}: thumb 区无可见像素（全背景）")
