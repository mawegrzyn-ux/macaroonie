"""Google Play store assets for Macaroonie Office, the second step (Pillow).

Run after make-assets.mjs, from the repo root:

    python3 office-app/store-assets/android/make-assets.py

- icon-512.png: the app's own icon (office-app/assets/icon.png, the one phones
  show) at 512 x 512, a 32-bit PNG with every pixel fully opaque: a full
  square, as Play wants it (Play rounds the corners itself).
- feature-graphic-1024x500.png and screenshots/*.png: the alpha channel taken
  off (Play wants 24-bit PNGs for these), each optimised.
- Then every file is checked: its size, its mode and that nothing is
  transparent; a wrong one stops the script. The table it prints is the one
  in store-listing.md.
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ICON = os.path.join(HERE, '..', '..', 'assets', 'icon.png')
BRAND_NAVY = (31, 42, 68)  # #1f2a44, app.json backgroundColor


def make_icon():
    src = Image.open(APP_ICON).convert('RGBA')
    # Anything not fully opaque sits on the brand navy, as on the phone.
    flat = Image.new('RGBA', src.size, BRAND_NAVY + (255,))
    flat.alpha_composite(src)
    icon = flat.resize((512, 512), Image.LANCZOS)
    icon.putalpha(255)
    icon.save(os.path.join(HERE, 'icon-512.png'), optimize=True)


def flatten(path):
    im = Image.open(path)
    if im.mode != 'RGB':
        rgba = im.convert('RGBA')
        flat = Image.new('RGB', rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.getchannel('A'))
        im = flat
    im.save(path, optimize=True)


def check(path, size, mode):
    im = Image.open(path)
    problems = []
    if im.size != size:
        problems.append('is %dx%d, not %dx%d' % (im.size + size))
    if im.mode != mode:
        problems.append('is %s, not %s' % (im.mode, mode))
    if im.mode == 'RGBA' and im.getchannel('A').getextrema()[0] < 255:
        problems.append('has transparent pixels')
    rel = os.path.relpath(path, HERE)
    if problems:
        print('FAIL', rel, '; '.join(problems))
        return False
    print('| `%s` | %d x %d | %s | %d KB |' % (rel, im.size[0], im.size[1], im.mode, round(os.path.getsize(path) / 1024)))
    return True


def main():
    make_icon()
    feature = os.path.join(HERE, 'feature-graphic-1024x500.png')
    shots_dir = os.path.join(HERE, 'screenshots')
    shots = sorted(os.path.join(shots_dir, f) for f in os.listdir(shots_dir) if f.endswith('.png'))
    for path in [feature] + shots:
        flatten(path)
    ok = check(os.path.join(HERE, 'icon-512.png'), (512, 512), 'RGBA')
    ok = check(feature, (1024, 500), 'RGB') and ok
    if os.path.getsize(feature) > 1024 * 1024:
        print('FAIL the feature graphic is over 1 MB')
        ok = False
    if len(shots) < 4:
        print('FAIL Play needs at least 4 phone screenshots, found %d' % len(shots))
        ok = False
    for path in shots:
        ok = check(path, (1080, 1920), 'RGB') and ok
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
