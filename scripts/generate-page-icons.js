// Regenerate page icons and manifests with Node.js and headless Chrome.
const fs = require("node:fs");
const path = require("node:path");
const {execFileSync} = require("node:child_process");

const root = path.resolve(__dirname,"..");
const output = path.join(root,"page-icons");
fs.mkdirSync(output,{recursive:true});

const pages = [
    {key:"tasks",name:"SeShat Tasks",short:"Tasks",color:"#2563eb",art:'<rect x="142" y="115" width="228" height="282" rx="26"/><path d="M183 194l18 18 34-40M256 194h68M183 270l18 18 34-40M256 270h68M183 346l18 18 34-40M256 346h68"/>'},
    {key:"notes",name:"SeShat Notes",short:"Notes",color:"#7c3aed",art:'<path d="M156 112h200v288H156zM196 184h120M196 239h120M196 294h92M196 349h72"/>'},
    {key:"calendar",name:"SeShat Calendar",short:"Calendar",color:"#0891b2",art:'<rect x="128" y="145" width="256" height="242" rx="24"/><path d="M128 215h256M190 110v70M322 110v70M186 263h20M246 263h20M306 263h20M186 326h20M246 326h20M306 326h20"/>'},
    {key:"documentvault",name:"SeShat Document Vault",short:"Documents",color:"#0d9488",art:'<path d="M158 112h143l53 53v235H158zM301 112v53h53M202 232h108M202 286h108M202 340h78"/>'},
    {key:"passwordvault",name:"SeShat Password Vault",short:"Passwords",color:"#b45309",art:'<rect x="150" y="225" width="212" height="164" rx="24"/><path d="M194 225v-51a62 62 0 01124 0v51M256 288v46"/>'},
    {key:"homemaintenance",name:"SeShat Home Maintenance",short:"Maintenance",color:"#c2410c",art:'<path d="M118 242l138-118 138 118M151 220v167h210V220M228 387v-92h56v92"/>'},
    {key:"food-recipes",name:"SeShat Food Recipes",short:"Food Recipes",color:"#dc2626",art:'<path d="M145 227h222v45c0 65-48 109-111 109s-111-44-111-109zM128 227h256M203 131c-22 25 22 35 0 62M256 131c-22 25 22 35 0 62M309 131c-22 25 22 35 0 62"/>'},
    {key:"household-recipes",name:"SeShat Household Recipes",short:"Home Recipes",color:"#0284c7",art:'<path d="M209 131h94v52l43 49v142H166V232l43-49zM209 131h94M210 280h92M256 247v66"/>'},
    {key:"settings",name:"SeShat Settings",short:"Settings",color:"#475569",art:'<circle cx="256" cy="256" r="95"/><circle cx="256" cy="256" r="33"/><path d="M256 112v49M256 351v49M112 256h49M351 256h49M154 154l35 35M323 323l35 35M358 154l-35 35M189 323l-35 35"/>'},
    {key:"push-key-setup",name:"SeShat Push Key Setup",short:"Push Setup",color:"#4f46e5",art:'<circle cx="199" cy="219" r="61"/><path d="M242 262l111 111M292 312l29-29M322 342l29-29"/>'}
];

const chrome = process.env.CHROME || "google-chrome";
for(const page of pages){
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="112" fill="#030712"/>
<circle cx="256" cy="256" r="190" fill="${page.color}"/>
<g fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" stroke-linejoin="round">${page.art}</g>
</svg>\n`;
    fs.writeFileSync(path.join(output,page.key + ".svg"),svg);
    const svgUrl = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
    const html = `<!doctype html><body>Rendering<script>
const image = new Image();
image.onload = () => {
    const result = {};
    for (const size of [180,192,512]) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image,0,0,size,size);
        result[size] = canvas.toDataURL('image/png').split(',')[1];
    }
    document.body.textContent = JSON.stringify(result);
};
image.onerror = () => { document.body.textContent = 'ERROR'; };
image.src = ${JSON.stringify(svgUrl)};
</script></body>`;
    const url = "data:text/html;base64," + Buffer.from(html).toString("base64");
    const dom = execFileSync(chrome,[
        "--headless","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
        "--virtual-time-budget=3000","--dump-dom",url
    ],{encoding:"utf8",stdio:["ignore","pipe","ignore"],maxBuffer:10*1024*1024});
    const match = dom.match(/<body>(\{.*\})<\/body>/s);
    if(!match) throw new Error("Unable to render " + page.key);
    const images = JSON.parse(match[1]);
    for(const size of [180,192,512]){
        fs.writeFileSync(path.join(output,`${page.key}-${size}.png`),Buffer.from(images[size],"base64"));
    }
    const manifest = {
        name:page.name,
        short_name:page.short,
        id:`./${page.key}.html`,
        start_url:`./${page.key}.html`,
        scope:"./",
        display:"standalone",
        background_color:"#030712",
        theme_color:"#030712",
        icons:[
            {src:`./page-icons/${page.key}-192.png`,sizes:"192x192",type:"image/png",purpose:"any"},
            {src:`./page-icons/${page.key}-512.png`,sizes:"512x512",type:"image/png",purpose:"any maskable"},
            {src:`./page-icons/${page.key}.svg`,sizes:"any",type:"image/svg+xml",purpose:"any"}
        ]
    };
    fs.writeFileSync(path.join(root,`${page.key}.webmanifest`),JSON.stringify(manifest,null,2) + "\n");
}
