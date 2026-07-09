import urllib.request
import json
import math
import io
import sys
import subprocess

try:
    from PIL import Image
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image

url = "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as response:
    img_data = response.read()

img = Image.open(io.BytesIO(img_data)).convert('L')
img = img.resize((512, 256))

points = []
width, height = img.size
pixels = img.load()

num_points_to_try = 30000
radius = 2.01
phi = math.pi * (3. - math.sqrt(5.))

for i in range(num_points_to_try):
    y = 1 - (i / float(num_points_to_try - 1)) * 2
    radius_at_y = math.sqrt(1 - y * y)
    theta = phi * i

    x = math.cos(theta) * radius_at_y
    z = math.sin(theta) * radius_at_y

    lat = math.asin(y)
    lon = math.atan2(z, x)

    u = int(((lon + math.pi) / (2 * math.pi)) * width) % width
    v = int(((math.pi / 2 - lat) / math.pi) * height) % height

    pixel_val = pixels[u, v]
    
    if pixel_val > 40:
        points.extend([x * radius, y * radius, z * radius])

with open("public/world-points.json", "w") as f:
    json.dump(points, f)

print(f"Generated {len(points)//3} points.")
