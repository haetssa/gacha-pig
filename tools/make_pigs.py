"""
AI로 만든 돼지 시트(정면/뒷면/옆면 3장이 한 이미지) -> 게임용 스프라이트 변환.

실행:  py tools/make_pigs.py [미리보기.png 저장경로]
입력:  프로젝트 폴더의 원본 PNG (SRC 참고, 배경은 마젠타)
출력:  public/assets/pigs/<id>.png       3x3 시트 (행: 아래/위/옆, 열: 서있기/걸음A/걸음B), 칸 48x48
       public/assets/pigs/<id>_icon.png  정면 아이콘 48x48

처리: 배경(마젠타) 제거 -> 같은 배율로 축소(돼지 키 44px) -> 전체 돼지 공통 팔레트로 색 통일
      -> 다리를 잘라 걸음 프레임 생성. 왼쪽 방향은 게임에서 옆면을 좌우 반전해서 사용.
"""
import os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'assets', 'pigs')
SRC = {  # 게임 id : 원본 파일
    'normal': 'nomal pig.png',
    'soldier': 'Army pig.png',
    'gym': 'health pig.png',
    'tech': 'engineer pig.png',
    'fat': 'Fat pig.png',
}
LEG_ROWS = {'normal': 7, 'soldier': 7, 'gym': 7, 'tech': 7, 'fat': 5}  # 걸음 프레임에서 움직일 다리 높이(px)
CELL, PIG_H, N_COLORS = 48, 44, 48
OUTLINE = (22, 16, 40)


def load_views(path):
    im = np.array(Image.open(path).convert('RGB')).astype(int)
    R, G, B = im[..., 0], im[..., 1], im[..., 2]
    bg = (np.minimum(R, B) - G) > 80          # 마젠타 계열
    bg[1250:, 2550:] = True                   # 우하단 AI 로고
    fg = ~bg
    cols = fg.sum(axis=0) > 3
    segs, s = [], None
    for x, on in enumerate(cols):
        if on and s is None: s = x
        if not on and s is not None:
            if x - s > 200: segs.append((s, x))
            s = None
    if s is not None: segs.append((s, len(cols)))
    if len(segs) != 3:
        raise SystemExit(f'{path}: 그림이 3개로 나뉘지 않음 {segs}')
    views = []
    for x0, x1 in segs:
        rows = np.where(fg[:, x0:x1].sum(axis=1) > 3)[0]
        y0, y1 = rows[0], rows[-1] + 1
        rgb = im[y0:y1, x0:x1].copy()
        m = fg[y0:y1, x0:x1]
        rgb[~m] = OUTLINE
        views.append((Image.fromarray(rgb.astype('uint8')), Image.fromarray((m * 255).astype('uint8'))))
    return views


def to_cell(rgb, alpha, scale):
    w, h = max(1, round(rgb.width * scale)), max(1, round(rgb.height * scale))
    r = rgb.resize((w, h), Image.BOX)
    a = alpha.resize((w, h), Image.BOX).point(lambda v: 255 if v > 127 else 0)
    cell = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    spr = r.convert('RGBA'); spr.putalpha(a)
    cell.alpha_composite(spr, ((CELL - w) // 2, CELL - h))   # 발을 맨 아래 줄에 맞춤
    return cell


def shift_region(cell, x0, x1, k, dx, dy):
    """바닥 k줄 중 x0~x1 부분을 (dx,dy)만큼 옮김 (다리 움직임)"""
    a = np.array(cell)
    y0 = CELL - k
    reg = a[y0:, x0:x1].copy()
    a[y0:, x0:x1] = 0
    for yy in range(reg.shape[0]):
        for xx in range(reg.shape[1]):
            if reg[yy, xx, 3] == 0: continue
            ny, nx = y0 + yy + dy, x0 + xx + dx
            if 0 <= ny < CELL and 0 <= nx < CELL: a[ny, nx] = reg[yy, xx]
    return Image.fromarray(a)


def make_steps(cell, side, k):
    if side:   # 옆모습: 다리가 앞뒤로 1px
        return shift_region(cell, 0, CELL, k, 1, 0), shift_region(cell, 0, CELL, k, -1, 0)
    h = CELL // 2   # 정면/뒷면: 왼발, 오른발 번갈아 1px 들기
    return shift_region(cell, 0, h, k, 0, -1), shift_region(cell, h, CELL, k, 0, -1)


def main():
    scale = None
    raw = {}
    for pid, fn in SRC.items():
        raw[pid] = load_views(os.path.join(ROOT, fn))
        if pid == 'normal':
            scale = PIG_H / raw[pid][0][0].height   # 기본 돼지의 키를 기준으로 모두 같은 배율
    cells = {pid: [to_cell(r, a, scale) for r, a in views] for pid, views in raw.items()}

    # 공통 팔레트
    px = np.concatenate([np.array(c)[np.array(c)[..., 3] > 0][:, :3] for cs in cells.values() for c in cs])
    strip = Image.fromarray(px.reshape(-1, 1, 3).astype('uint8'))
    pal = strip.quantize(N_COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    for pid in cells:
        for i, c in enumerate(cells[pid]):
            a = c.getchannel('A')
            q = c.convert('RGB').quantize(palette=pal, dither=Image.Dither.NONE).convert('RGBA')
            q.putalpha(a)
            cells[pid][i] = q

    os.makedirs(OUT, exist_ok=True)
    for pid, (down, up, side) in cells.items():
        k = LEG_ROWS[pid]
        sheet = Image.new('RGBA', (CELL * 3, CELL * 3), (0, 0, 0, 0))
        for row, (v, is_side) in enumerate([(down, False), (up, False), (side, True)]):
            a, b = make_steps(v, is_side, k)
            for col, img in enumerate([v, a, b]):
                sheet.alpha_composite(img, (col * CELL, row * CELL))
        sheet.save(os.path.join(OUT, f'{pid}.png'))
        down.save(os.path.join(OUT, f'{pid}_icon.png'))
        print('saved', pid)

    if len(sys.argv) > 1:   # 미리보기
        S = 5
        pv = Image.new('RGBA', (CELL * 9 * S // 3 * 1, 1), (0, 0, 0, 0))
        W = CELL * 3 * S
        big = Image.new('RGBA', (W * len(SRC) // 1, CELL * 3 * S), (80, 140, 80, 255))
        for i, pid in enumerate(SRC):
            sh = Image.open(os.path.join(OUT, f'{pid}.png')).resize((W, CELL * 3 * S), Image.NEAREST)
            big.alpha_composite(sh, (i * W, 0))
        big.convert('RGB').save(sys.argv[1])


if __name__ == '__main__':
    main()
