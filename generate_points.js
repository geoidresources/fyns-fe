const Jimp = require('jimp');
const fs = require('fs');

async function main() {
    const url = "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg";
    const img = await Jimp.read(url);
    img.resize(512, 256);
    
    const points = [];
    const width = img.bitmap.width;
    const height = img.bitmap.height;
    
    const num_points_to_try = 30000;
    const radius = 2.01;
    const phi = Math.PI * (3 - Math.sqrt(5));
    
    for (let i = 0; i < num_points_to_try; i++) {
        const y = 1 - (i / (num_points_to_try - 1)) * 2;
        const radius_at_y = Math.sqrt(1 - y * y);
        const theta = phi * i;
        
        const x = Math.cos(theta) * radius_at_y;
        const z = Math.sin(theta) * radius_at_y;
        
        const lat = Math.asin(y);
        const lon = Math.atan2(z, x);
        
        let u = Math.floor(((lon + Math.PI) / (2 * Math.PI)) * width) % width;
        let v = Math.floor(((Math.PI / 2 - lat) / Math.PI) * height) % height;
        
        const color = img.getPixelColor(u, v);
        const r = (color >> 24) & 255;
        const g = (color >> 16) & 255;
        const b = (color >> 8) & 255;
        const brightness = (r + g + b) / 3;
        
        if (brightness > 40 && brightness < 200) { // ocean is very dark, some land is bright white (ice) or grey/green. Actually land is > 40. 
            points.push(x * radius, y * radius, z * radius);
        }
    }
    
    fs.writeFileSync("public/world-points.json", JSON.stringify(points));
    console.log("Generated " + (points.length / 3) + " points.");
}
main();
