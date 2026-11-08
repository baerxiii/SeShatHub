const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname,"..");
const pages = [
    "tasks","notes","calendar","documentvault","passwordvault","homemaintenance",
    "food-recipes","household-recipes","settings","push-key-setup"
];
const ids = new Set();
const signatures = new Set();
const read = file => fs.readFileSync(path.join(root,file));
const png = (file,size) => {
    const bytes = read(file);
    assert.equal(bytes.subarray(0,8).toString("hex"),"89504e470d0a1a0a",file);
    assert.equal(bytes.readUInt32BE(16),size,file);
    assert.equal(bytes.readUInt32BE(20),size,file);
    return bytes;
};

for(const page of pages){
    const html = read(page + ".html").toString();
    assert.ok(html.includes(`rel="icon" type="image/svg+xml" href="./page-icons/${page}.svg"`),page);
    assert.ok(html.includes(`rel="apple-touch-icon" href="./page-icons/${page}-180.png"`),page);
    assert.ok(html.includes(`rel="manifest" href="./${page}.webmanifest"`),page);
    const manifest = JSON.parse(read(page + ".webmanifest"));
    assert.equal(manifest.id,`./${page}.html`,page);
    assert.equal(manifest.start_url,`./${page}.html`,page);
    assert.equal(manifest.scope,"./",page);
    assert.ok(!ids.has(manifest.id),page);
    ids.add(manifest.id);
    assert.ok(read(`page-icons/${page}.svg`).toString().startsWith("<svg"),page);
    png(`page-icons/${page}-180.png`,180);
    png(`page-icons/${page}-192.png`,192);
    const image = png(`page-icons/${page}-512.png`,512);
    signatures.add(image.toString("base64"));
    for(const icon of manifest.icons){
        const file = icon.src.replace(/^\.\//,"");
        assert.ok(fs.existsSync(path.join(root,file)),`${page}: ${file}`);
    }
}
assert.equal(signatures.size,pages.length,"Each page needs a distinct icon.");
const index = read("index.html").toString();
assert.ok(index.includes('rel="manifest" href="./manifest.json"'));
assert.ok(index.includes('rel="icon" type="image/svg+xml" href="./icon.svg"'));
assert.ok(index.includes('rel="apple-touch-icon" href="./apple-touch-icon.png"'));
console.log("Page icon tests passed.");
