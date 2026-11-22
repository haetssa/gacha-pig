"""
AI로 만든 타일 시트(마젠타 배경에 물체들이 흩어져 있는 이미지) -> 게임용 타일/아이템 이미지.

실행:  py tools/make_tiles.py [미리보기.png 저장경로]

SHEETS에 시트를 추가한다. order = 시트 안 물체를 "왼쪽→오른쪽, 위→아래" 순서로 읽은 역할 이름.
 역할 이름:  floor / hard / soft / crate / border  -> 테마(맵 분위기) 전용. 같은 역할이 여러 개면 번갈아 사용
             common:bomb / common:item_bomb / common:item_fire / common:item_speed -> 모든 테마 공용
 'skip' 은 건너뜀. 이름 뒤에 *2 를 붙이면 연속된 물체 2개를 한 그림으로 합침 (예: 폭탄 2개 묶음)
출력: public/assets/themes/<theme>/*.png + theme.json,  public/assets/common/*.png
칸 크기 48x48. 새 테마 = 시트 한 장 + 아래 SHEETS에 한 줄 추가.
"""
import os, sys, json
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'public', 'assets')
CELL, N_COLORS = 48, 40
OUTLINE = (22, 16, 40)

SHEETS = [
    {'file': 'Tiles-1.png', 'theme': 'farm', 'order': [
        'floor', 'floor', 'hard', 'soft',
        'crate', 'border', 'border',
        'common:bomb', 'common:item_bomb*2', 'common:item_fire', 'common:item_speed',
    ]},
    {'file': 'Factory tiles-1.png', 'theme': 'factory', 'order': [
        'floor', 'floor', 'floor', 'hard', 'hard',
        'soft', 'soft', 'soft', 'crate', 'border', 'border',
    ]},
]
# 역할별 최대 크기(px). 바닥은 칸 전체를 채운다
FIT = {'hard': 46, 'soft': 46, 'crate': 46, 'border': 48, 'bomb': 44, 'item_bomb': 40, 'item_fire': 40, 'item_speed': 40}


def find_objects(path):
    im = np.array(Image.open(path).convert('RGB')).astype(int)
    R, G, B = im[..., 0], im[..., 1], im[..., 2]
    bg = (np.minimum(R, B) - G) > 80
    bg[1250:, 2550:] = True                      # 우하단 AI 로고
    fg = ~bg
    # 떨어진 조각(폭탄 불꽃 등)을 한 물체로 묶기 위해 마스크를 키워서 라벨링
    D = 8
    small = Image.fromarray((fg * 255).astype('uint8')).resize((fg.shape[1] // D, fg.shape[0] // D), Image.BOX)
    m = np.array(small.filter(ImageFilter.MaxFilter(5))) > 20
    lab = np.zeros(m.shape, int); n = 0
    for y in range(m.shape[0]):
        for x in range(m.shape[1]):
            if m[y, x] and not lab[y, x]:
                n += 1; stack = [(y, x)]; lab[y, x] = n
                while stack:
                    cy, cx = stack.pop()
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < m.shape[0] and 0 <= nx < m.shape[1] and m[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n; stack.append((ny, nx))
    objs = []
    for k in range(1, n + 1):
        ys, xs = np.where(lab == k)
        if len(ys) < 12: continue                # 잡티
        x0, x1, y0, y1 = xs.min() * D, (xs.max() + 1) * D, ys.min() * D, (ys.max() + 1) * D
        sub = fg[y0:y1, x0:x1]
        yy, xx = np.where(sub)
        x0, x1, y0, y1 = x0 + xx.min(), x0 + xx.max() + 1, y0 + yy.min(), y0 + yy.max() + 1
        objs.append({'box': (x0, y0, x1, y1), 'cy': (y0 + y1) / 2, 'cx': (x0 + x1) / 2})
    # 읽는 순서: 위쪽 줄부터, 같은 줄이면 왼쪽부터
    objs.sort(key=lambda o: o['cy'])
    rows, cur = [], [objs[0]]
    for o in objs[1:]:
        if o['cy'] - np.mean([c['cy'] for c in cur]) > 200: rows.append(cur); cur = [o]
        else: cur.append(o)
    rows.append(cur)
    ordered = [o for r in rows for o in sorted(r, key=lambda o: o['cx'])]
    return im, fg, ordered


def crop_rgba(im, fg, box):
    x0, y0, x1, y1 = box
    rgb = im[y0:y1, x0:x1].copy(); m = fg[y0:y1, x0:x1]
    rgb[~m] = OUTLINE
    img = Image.fromarray(rgb.astype('uint8')).convert('RGBA')
    img.putalpha(Image.fromarray((m * 255).astype('uint8')))
    return img


def fit(img, size, role):
    s = min(size / img.width, size / img.height)
    w, h = max(1, round(img.width * s)), max(1, round(img.height * s))
    rgb = img.convert('RGB').resize((w, h), Image.BOX)
    a = img.getchannel('A').resize((w, h), Image.BOX).point(lambda v: 255 if v > 127 else 0)
    spr = rgb.convert('RGBA'); spr.putalpha(a)
    cell = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    cell.alpha_composite(spr, ((CELL - w) // 2, CELL - h - (0 if role in ('border', 'hard', 'soft', 'crate') else 4)))
    return cell


def floor_tile(img):
    """바닥: 테두리 선과 아래쪽 어두운 띠를 잘라내고, 안쪽에서 정사각형을 떼어 칸 크기로 맞춤"""
    w, h = img.size
    mx, top, bot = int(w * 0.05), int(h * 0.06), int(h * 0.12)
    inner = img.convert('RGB').crop((mx, top, w - mx, h - bot))
    side = min(inner.width, inner.height)
    sq = inner.crop(((inner.width - side) // 2, 0, (inner.width + side) // 2, side))
    return sq.resize((CELL, CELL), Image.BOX).convert('RGBA')


def quantize_all(imgs):
    px = np.concatenate([np.array(i)[np.array(i)[..., 3] > 0][:, :3] for i in imgs])
    pal = Image.fromarray(px.reshape(-1, 1, 3).astype('uint8')).quantize(
        N_COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    out = []
    for i in imgs:
        a = i.getchannel('A')
        q = i.convert('RGB').quantize(palette=pal, dither=Image.Dither.NONE).convert('RGBA')
        q.putalpha(a); out.append(q)
    return out


def main():
    preview = []
    for sh in SHEETS:
        im, fg, objs = find_objects(os.path.join(ROOT, sh['file']))
        roles, need = sh['order'], sum(2 if r.endswith('*2') else 1 for r in sh['order'])
        if len(objs) != need:
            raise SystemExit(f"{sh['file']}: 물체 {len(objs)}개 발견, order가 가리키는 물체는 {need}개. order를 맞춰주세요.")
        items, pos = [], 0   # (role, image)
        for role in roles:
            box = objs[pos]['box']
            if role.endswith('*2'):
                role = role[:-2]; b2 = objs[pos + 1]['box']; pos += 1
                box = (min(box[0], b2[0]), min(box[1], b2[1]), max(box[2], b2[2]), max(box[3], b2[3]))
            pos += 1
            if role == 'skip': continue
            img = crop_rgba(im, fg, box)
            base = role.split(':')[-1]
            items.append((role, floor_tile(img) if base == 'floor' else fit(img, FIT[base], base)))
        qs = quantize_all([i for _, i in items])
        theme_dir = os.path.join(ASSETS, 'themes', sh['theme']); common_dir = os.path.join(ASSETS, 'common')
        os.makedirs(theme_dir, exist_ok=True); os.makedirs(common_dir, exist_ok=True)
        manifest, count = {}, {}
        for (role, _), q in zip(items, qs):
            if role.startswith('common:'):
                name = role.split(':')[1]
                q.save(os.path.join(common_dir, name + '.png'))
            else:
                k = count.get(role, 0); count[role] = k + 1
                fn = f'{role}{k}.png'
                q.save(os.path.join(theme_dir, fn))
                manifest.setdefault(role, []).append(fn)
            preview.append(q)
        json.dump(manifest, open(os.path.join(theme_dir, 'theme.json'), 'w'), indent=1)
        print(sh['theme'], manifest, [r for r, _ in items if r.startswith('common:')])
    if len(sys.argv) > 1:
        S = 4
        bg = Image.new('RGBA', (CELL * S * 6, CELL * S * ((len(preview) + 5) // 6)), (106, 191, 79, 255))
        for i, q in enumerate(preview):
            bg.alpha_composite(q.resize((CELL * S, CELL * S), Image.NEAREST), ((i % 6) * CELL * S, (i // 6) * CELL * S))
        bg.convert('RGB').save(sys.argv[1])


if __name__ == '__main__':
    main()
