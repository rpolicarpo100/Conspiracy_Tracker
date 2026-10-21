import { forceSimulation, forceLink, forceManyBody, forceCollide, forceCenter } from 'd3-force';
const n=5000;const nodes=[],edges=[];
for(let i=0;i<n;i++)nodes.push({id:'n'+i});
for(let i=1;i<n*2.5;i++)edges.push({source:'n'+(i%n),target:'n'+Math.floor(Math.pow(Math.random(),2.2)*n)});
const t=performance.now();
const sim=forceSimulation(nodes).force('link',forceLink(edges.map(e=>({...e}))).id(d=>d.id).distance(40))
 .force('charge',forceManyBody().strength(-60)).force('collide',forceCollide(6)).force('center',forceCenter(0,0)).stop();
for(let i=0;i<300;i++)sim.tick();
console.log(JSON.stringify({nodes:n,edges:edges.length,d3_force:Math.round(performance.now()-t),peakRssMB:Math.round(process.memoryUsage().rss/1048576)}));
