import { chromium } from 'playwright';
const B = await chromium.launch({ executablePath: '/home/user/.cache/ms-playwright/chromium-1140/chrome-linux/chrome', args: ['--no-sandbox','--disable-dev-shm-usage'], headless: true });
const page = await B.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const r = await page.evaluate(async () => {
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:1600px;height:900px;z-index:9999;background:#000';
  document.body.appendChild(host);
  const n = 1000;
  const mk = (withImg) => {
    const img = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" rx="14" fill="#0369a1"/></svg>');
    const nodes = [], edges = [];
    for (let i = 0; i < n; i++) nodes.push({ id: 'n'+i, label: 'Nó '+i, color: '#38bdf8', size: 28, status: 'confirmed', deg: 2, kind: 'person', img: withImg ? img : null });
    for (let i = 1; i < n*2.5; i++) edges.push({ id:'e'+i, source:'n'+(i%n), target:'n'+Math.floor(Math.pow(Math.random(),2.2)*n), color:'#818cf8', w:1, w2:2, style:'solid', relLabel:'Financiou', status:'confirmed' });
    return { nodes, edges };
  };
  const fpsFor = () => new Promise((res) => {
    let frames = 0; const start = performance.now();
    function tick(){ const now = performance.now(); eng.cy.panBy({x:4,y:0}); frames++; if (now-start<1800) requestAnimationFrame(tick); else res(Math.round(frames/((now-start)/1000))); }
    requestAnimationFrame(tick);
  });
  const out = {};
  let eng;

  eng = new VN.Engine(host, {theme:'dark'}); eng.init();
  let d = mk(true); eng.sync(d, {mode:'preset', fit:true}); out.comImagens = await fpsFor();
  eng.cy.nodes().addClass('lite'); out.liteClasse = await fpsFor();
  eng.setLabels(false, false); out.liteSemEtiquetas = await fpsFor();
  eng.cy.edges().style('display','none'); out.liteSemLigacoes = await fpsFor();
  eng.destroy();

  eng = new VN.Engine(host, {theme:'dark'}); eng.init();
  d = mk(false); eng.sync(d, {mode:'preset', fit:true}); out.semImagens = await fpsFor();
  eng.setLabels(false,false); out.semImagensSemEtiquetas = await fpsFor();
  out.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null;
  eng.destroy(); host.remove();
  return out;
});
console.log(JSON.stringify(r, null, 2));
await B.close();
