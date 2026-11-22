"""
폭발 이미지 시트(3x3, 칸마다 테두리 상자) -> 게임용 48x48 폭발 조각.

실행:  py tools/make_effects.py [미리보기.png 저장경로]
입력:  effects-1.png  (행: 가운데/중간 줄기/끝부분,  열: 프레임 1(크게)~3(사그라듦))
출력:  public/assets/effects/flames.png  3x3 시트, 칸 48x48 (같은 행/열 구성)

원본 칸이 가로로 긴 직사각형(약 1.8:1)이라, 칸 전체를 48x48로 맞춘다(가로로 줄어듦).
이렇게 해야 줄기가 칸 좌우 끝에 닿고 끝부분 모양이 칸 안에 정확히 들어온다.
새 시트가 정사각형 칸이면 CELLS를 거기에 맞춰 고치면 된다.
"""
import os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'effects-1.png')
OUT = os.path.join(ROOT, 'public', 'assets', 'effects')
CELL, INSET, N_COLORS = 48, 18, 28
OUTLINE = (22, 16, 40)
# 칸 테두리 상자 위치(원본 픽셀): 열 x범위, 행 y범위
COLS = [(86, 907), (991, 1766), (1843, 2671)]
ROWS = [(59, 521), (551, 1003), (1033, 1485)]


def main():
    im = np.array(Image.open(SRC).convert('RGB')).astype(int)
    R, G, B = im[..., 0], im[..., 1], im[..., 2]
    bg = (np.minimum(R, B) - G) > 80
    cells = []
    for (y0, y1) in ROWS:
        for (x0, x1) in COLS:
            x0, y0, x1, y1 = x0 + INSET, y0 + INSET, x1 - INSET, y1 - INSET
            rgb = im[y0:y1, x0:x1].copy(); m = ~bg[y0:y1, x0:x1]
            rgb[~m] = OUTLINE
            a = Image.fromarray((m * 255).astype('uint8')).resize((CELL, CELL), Image.BOX).point(lambda v: 255 if v > 127 else 0)
            c = Image.fromarray(rgb.astype('uint8')).resize((CELL, CELL), Image.BOX).convert('RGBA')
            c.putalpha(a)
            cells.append(c)
    px = np.concatenate([np.array(c)[np.array(c)[..., 3] > 0][:, :3] for c in cells])
    pal = Image.fromarray(px.reshape(-1, 1, 3).astype('uint8')).quantize(
        N_COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    sheet = Image.new('RGBA', (CELL * 3, CELL * 3), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        a = c.getchannel('A')
        q = c.convert('RGB').quantize(palette=pal, dither=Image.Dither.NONE).convert('RGBA'); q.putalpha(a)
        sheet.alpha_composite(q, ((i % 3) * CELL, (i // 3) * CELL))
    os.makedirs(OUT, exist_ok=True)
    sheet.save(os.path.join(OUT, 'flames.png'))
    print('saved flames.png')
    if len(sys.argv) > 1:
        S = 4
        bg2 = Image.new('RGBA', (CELL * 3 * S, CELL * 3 * S), (90, 90, 100, 255))
        bg2.alpha_composite(sheet.resize((CELL * 3 * S, CELL * 3 * S), Image.NEAREST))
        bg2.convert('RGB').save(sys.argv[1])


if __name__ == '__main__':
    main()
