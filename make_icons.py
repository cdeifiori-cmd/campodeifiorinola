import urllib.request
from PIL import Image
import io, os, ssl

# Logo app con sfondo
url = 'https://res.cloudinary.com/dxqyprtzh/image/upload/v1780146911/logo_campo_sito_web_ed52gm.png'
out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
os.makedirs(out_dir, exist_ok=True)

print('Download immagine...')
ctx = ssl.create_default_context()
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, context=ctx) as r:
    data = r.read()

img = Image.open(io.BytesIO(data)).convert('RGBA')
print(f'Dimensione originale: {img.size}')

for size in [192, 512]:
    resized = img.resize((size, size), Image.LANCZOS)
    # Sfondo bianco per PNG opaco
    bg = Image.new('RGBA', (size, size), (255, 255, 255, 255))
    bg.paste(resized, mask=resized.split()[3])
    path = os.path.join(out_dir, f'icon-{size}.png')
    bg.convert('RGB').save(path, 'PNG')
    print(f'OK: {path}')

print('Icone create.')
