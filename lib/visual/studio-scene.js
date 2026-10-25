/* LNX Beats — decorative native WebGL. No private media or external renderer. */
const MAX_TEXTURES = 6;
const MAX_TEXTURE_EDGE = 1024;

/** Only the existing public cover endpoint and local public assets are eligible.
 * Keep invalid/empty entries empty: filtering would substitute another album. */
export function studioCoverSource(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || value.startsWith('//') || /[\s\\]/.test(value) || /%(?:2e|2f|5c)/i.test(value)) return '';
  try {
    const url = new URL(value, 'https://lnx.invalid');
    if (url.origin !== 'https://lnx.invalid' || url.hash || url.search) return '';
    return /^\/(?:assets\/[^?]+|media\/catalog\/[a-zA-Z0-9-]+)$/.test(url.pathname) ? url.pathname : '';
  } catch { return ''; }
}

const VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform mat4 uModel;
uniform mat4 uViewProjection;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
void main(){
  vec4 world = uModel * vec4(aPosition, 1.0);
  vPosition = world.xyz;
  vNormal = normalize(mat3(uModel) * aNormal);
  vUv = aUv;
  gl_Position = uViewProjection * world;
}`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D uTexture;
uniform vec3 uColor;
uniform vec3 uEye;
uniform float uTextured;
uniform float uMetal;
uniform float uEmission;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vUv;
void main(){
  vec3 normal = normalize(vNormal);
  vec3 eye = normalize(uEye - vPosition);
  vec3 warm = normalize(vec3(-2.8, 6.5, 5.0));
  vec3 cool = normalize(vec3(4.0, 3.0, -2.0));
  float diffuse = max(dot(normal, warm), 0.0);
  float fill = max(dot(normal, cool), 0.0);
  vec3 base = uColor;
  if(uTextured > 0.5) base *= texture2D(uTexture, vUv).rgb;
  vec3 lit = base * (vec3(0.35, 0.36, 0.39) + diffuse * vec3(0.86, 0.80, 0.65) + fill * vec3(0.12, 0.19, 0.28));
  float specular = pow(max(dot(normal, normalize(warm + eye)), 0.0), mix(22.0, 68.0, uMetal));
  float rim = pow(1.0 - max(dot(normal, eye), 0.0), 3.2);
  lit += vec3(1.0, 0.78, 0.38) * (specular * uMetal * 1.25 + rim * uMetal * 0.18);
  // A faint warm pool on the upper plateau, not a fake duplicated cover.
  vec2 pool = vec2(vPosition.x * 0.42, (vPosition.z - 0.4) * 0.72);
  float floorLight = exp(-dot(pool, pool) * 2.0) * max(normal.y, 0.0) * uMetal * (1.0 - uTextured);
  lit += vec3(0.055, 0.031, 0.007) * floorLight;
  lit += base * uEmission;
  gl_FragColor = vec4(pow(max(lit, vec3(0.0)), vec3(0.92)), 1.0);
}`;

function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col=0; col<4; col++) for (let row=0; row<4; row++) {
    out[col*4+row] = a[row]*b[col*4] + a[4+row]*b[col*4+1] + a[8+row]*b[col*4+2] + a[12+row]*b[col*4+3];
  }
  return out;
}
function model(x=0,y=0,z=0,rx=0,ry=0,rz=0,scale=1) {
  const cx=Math.cos(rx),sx=Math.sin(rx),cy=Math.cos(ry),sy=Math.sin(ry),cz=Math.cos(rz),sz=Math.sin(rz);
  const mx=new Float32Array([1,0,0,0, 0,cx,sx,0, 0,-sx,cx,0, 0,0,0,1]);
  const my=new Float32Array([cy,0,-sy,0, 0,1,0,0, sy,0,cy,0, 0,0,0,1]);
  const mz=new Float32Array([cz,sz,0,0, -sz,cz,0,0, 0,0,1,0, 0,0,0,1]);
  const out=multiply(multiply(mz,my),mx);
  for(let i=0;i<12;i++) out[i]*=scale;
  out[12]=x;out[13]=y;out[14]=z;
  return out;
}
function perspective(fov,aspect,near,far) {
  const f=1/Math.tan(fov/2),nf=1/(near-far),out=new Float32Array(16);
  out[0]=f/aspect;out[5]=f;out[10]=(far+near)*nf;out[11]=-1;out[14]=2*far*near*nf;
  return out;
}
function normalize(v) { const n=Math.hypot(...v)||1;return v.map(x=>x/n); }
function cross(a,b) { return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function lookAt(eye,target) {
  const z=normalize(eye.map((v,i)=>v-target[i])),x=normalize(cross([0,1,0],z)),y=cross(z,x);
  return new Float32Array([x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
    -x.reduce((s,v,i)=>s+v*eye[i],0),-y.reduce((s,v,i)=>s+v*eye[i],0),-z.reduce((s,v,i)=>s+v*eye[i],0),1]);
}
function builder() {
  const values=[];
  return {
    triangle(a,b,c,normal,uvA=[0,0],uvB=[1,0],uvC=[1,1]) {
      for(const [p,uv] of [[a,uvA],[b,uvB],[c,uvC]]) values.push(...p,...normal,...uv);
    },
    quad(a,b,c,d,n) { this.triangle(a,b,c,n,[0,0],[1,0],[1,1]);this.triangle(a,c,d,n,[0,0],[1,1],[0,1]); },
    data() { return new Float32Array(values); },
  };
}
function box(width,height,depth) {
  const b=builder(),x=width/2,y=height/2,z=depth/2;
  b.quad([-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z],[0,0,1]);
  b.quad([x,-y,-z],[-x,-y,-z],[-x,y,-z],[x,y,-z],[0,0,-1]);
  b.quad([x,-y,z],[x,-y,-z],[x,y,-z],[x,y,z],[1,0,0]);
  b.quad([-x,-y,-z],[-x,-y,z],[-x,y,z],[-x,y,-z],[-1,0,0]);
  b.quad([-x,y,z],[x,y,z],[x,y,-z],[-x,y,-z],[0,1,0]);
  b.quad([-x,-y,-z],[x,-y,-z],[x,-y,z],[-x,-y,z],[0,-1,0]);
  return b.data();
}
function front(size,z) { const b=builder(),h=size/2;b.quad([-h,-h,z],[h,-h,z],[h,h,z],[-h,h,z],[0,0,1]);return b.data(); }
function cylinder(radius,height,segments=72) {
  const b=builder(),y=height/2;
  for(let i=0;i<segments;i++) {
    const a=i/segments*Math.PI*2,c=(i+1)/segments*Math.PI*2;
    const p=[Math.cos(a)*radius,Math.sin(a)*radius],q=[Math.cos(c)*radius,Math.sin(c)*radius];
    b.triangle([0,y,0],[p[0],y,p[1]],[q[0],y,q[1]],[0,1,0]);
    b.quad([p[0],-y,p[1]],[q[0],-y,q[1]],[q[0],y,q[1]],[p[0],y,p[1]],normalize([p[0]+q[0],0,p[1]+q[1]]));
    b.triangle([0,-y,0],[q[0],-y,q[1]],[p[0],-y,p[1]],[0,-1,0]);
  }
  return b.data();
}
function torus(radius,tube,segments=96,sides=6) {
  const values=[];
  const point=(i,j)=>{
    const a=i/segments*Math.PI*2,b=j/sides*Math.PI*2,c=Math.cos(b),s=Math.sin(b);
    return { p:[Math.cos(a)*(radius+tube*c),tube*s,Math.sin(a)*(radius+tube*c)],n:[Math.cos(a)*c,s,Math.sin(a)*c],uv:[i/segments,j/sides] };
  };
  for(let i=0;i<segments;i++) for(let j=0;j<sides;j++) {
    const a=point(i,j),b=point(i+1,j),c=point(i+1,j+1),d=point(i,j+1);
    for(const p of [a,b,c,a,c,d]) values.push(...p.p,...p.n,...p.uv);
  }
  return new Float32Array(values);
}
function crystal() {
  const b=builder(),top=[0,1,0],bottom=[0,-1,0],points=[[1,0,0],[0,0,1],[-1,0,0],[0,0,-1]];
  for(let i=0;i<4;i++) {
    const a=points[i],c=points[(i+1)%4];
    b.triangle(top,a,c,normalize(cross(a.map((v,k)=>v-top[k]),c.map((v,k)=>v-top[k]))));
    b.triangle(bottom,c,a,normalize(cross(c.map((v,k)=>v-bottom[k]),a.map((v,k)=>v-bottom[k]))));
  }
  return b.data();
}

export function createStudioScene(canvas, {covers=[],onReady=()=>{},onError=()=>{},initialIndex=0,mode='hero',reducedMotion=false}={}) {
  const ARTWORKS = covers.map(studioCoverSource);
  const noScene = () => ({setIndex(){},setMode(){},setMotion(){},setPointer(){},setScroll(){},dispose(){},getStats(){return {available:false};}});
  if (!ARTWORKS.length) { canvas.dataset.sceneReady='false'; return noScene(); }
  canvas.dataset.sceneReady='false';
  let gl;
  try { gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,powerPreference:'low-power'}); } catch { /* Keep the existing DOM artwork when context creation is forbidden. */ }
  if(!gl) {
    canvas.dataset.sceneStats=JSON.stringify({available:false,renderer:null});
    onError(new Error('WebGL indisponible : aperçu statique conservé.'));
    return noScene();
  }
  let disposed=false,lost=false,ready=false,frame=0,drawCalls=0,triangles=0,frames=0,lastTime=0,elapsed=0;
  let enabled=!reducedMotion,inView=true,index=((Math.trunc(Number(initialIndex)||0)%ARTWORKS.length)+ARTWORKS.length)%ARTWORKS.length;
  let currentMode=mode,scroll=0,pointer=[0,0],smoothPointer=[0,0],transition=1,previousIndex=index;
  let width=1,height=1,dpr=1;
  const frameIntervals=[],cpuTimes=[];
  let previousRaf=0,wasAnimating=false,lastDrawTime=0;
  const resources={buffers:[],textures:[],shaders:[]};
  function fail(error) { if(!disposed){canvas.dataset.sceneReady='false';onError(error instanceof Error?error:new Error(String(error)));} }
  function compile(type,source) {
    const shader=gl.createShader(type);resources.shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)||'Shader WebGL non compilé');
    return shader;
  }
  let program,location;
  try {
    program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,VERTEX));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,FRAGMENT));gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Scène WebGL non liée');
    location={};
    for(const name of ['aPosition','aNormal','aUv'])location[name]=gl.getAttribLocation(program,name);
    for(const name of ['uModel','uViewProjection','uColor','uEye','uTextured','uMetal','uEmission','uTexture'])location[name]=gl.getUniformLocation(program,name);
  } catch(error) { fail(error);for(const shader of resources.shaders)gl.deleteShader(shader);if(program)gl.deleteProgram(program);return noScene(); }
  const mesh=(data)=>{
    const buffer=gl.createBuffer();resources.buffers.push(buffer);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    return {buffer,count:data.length/8};
  };
  const meshes={
    jacket:mesh(box(2.86,2.86,.18)),frame:mesh(box(2.91,2.91,.12)),art:mesh(front(2.80,.096)),
    base:mesh(cylinder(3.72,.28)),top:mesh(cylinder(3.58,.025)),ring:mesh(torus(3.67,.009)),
    inner:mesh(torus(2.86,.006)),groove:mesh(torus(3.28,.004)),diamond:mesh(crystal()),
  };
  const gold=[.76,.50,.16],dark=[.035,.038,.044],ink=[.014,.017,.022];
  function texture() {
    const item=gl.createTexture();resources.textures.push(item);gl.bindTexture(gl.TEXTURE_2D,item);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([38,38,34,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    return item;
  }
  const neutralTexture=texture(),textures=new Map(),textureStates=ARTWORKS.map(src=>src?'idle':'empty');
  let textureClock=0;
  function currentIndexes() { return [...new Set([index,(index+ARTWORKS.length-1)%ARTWORKS.length,(index+1)%ARTWORKS.length])]; }
  function markReady() {
    const currentReady=textureStates[index]==='ready';
    if(currentReady&&!ready){ready=true;canvas.dataset.sceneReady='true';onReady({renderer:'WebGL natif',artworkCount:ARTWORKS.length});}
    else if(!currentReady&&ready){ready=false;canvas.dataset.sceneReady='false';}
  }
  function ensureArtwork(i) {
    if(!ARTWORKS[i]||disposed||lost)return;
    const cached=textures.get(i);if(cached){cached.used=++textureClock;return;}
    while(textures.size>=MAX_TEXTURES){
      const protectedIndexes=[...currentIndexes(),...(transition<1?[previousIndex]:[])];
      const oldest=[...textures.entries()].filter(([key])=>!protectedIndexes.includes(key)).sort((a,b)=>a[1].used-b[1].used)[0];
      if(!oldest)break;
      if(oldest[1].image){oldest[1].image.onload=null;oldest[1].image.onerror=null;}
      gl.deleteTexture(oldest[1].texture);resources.textures.splice(resources.textures.indexOf(oldest[1].texture),1);
      textureStates[oldest[0]]='idle';textures.delete(oldest[0]);
    }
    const item={texture:texture(),image:new Image(),used:++textureClock};textures.set(i,item);textureStates[i]='loading';
    item.image.decoding='async';
    item.image.onload=()=>{
      if(disposed||lost||textures.get(i)!==item)return;
      try {
        let input=item.image;
        if(Math.max(input.naturalWidth,input.naturalHeight)>MAX_TEXTURE_EDGE){
          const scaled=document.createElement('canvas'),ratio=MAX_TEXTURE_EDGE/Math.max(input.naturalWidth,input.naturalHeight);
          scaled.width=Math.max(1,Math.round(input.naturalWidth*ratio));scaled.height=Math.max(1,Math.round(input.naturalHeight*ratio));
          const context=scaled.getContext('2d');if(!context)throw new Error('Cover scaling unavailable');
          context.drawImage(input,0,0,scaled.width,scaled.height);input=scaled;
        }
        gl.bindTexture(gl.TEXTURE_2D,item.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,input);textureStates[i]='ready';
      } catch {textureStates[i]='error';}
      item.image.onload=null;item.image.onerror=null;item.image=null;
      requestRender();
    };
    item.image.onerror=()=>{if(disposed||textures.get(i)!==item)return;textureStates[i]='error';item.image.onload=null;item.image.onerror=null;item.image=null;requestRender();};
    item.image.src=ARTWORKS[i];
  }
  function prepareArtwork(){currentIndexes().forEach(ensureArtwork);}
  prepareArtwork();
  gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);
  const eye=[0,2.15,8.4];
  function draw(geometry,transform,color,{textureIndex=null,metal=.2,emission=0}={}) {
    gl.bindBuffer(gl.ARRAY_BUFFER,geometry.buffer);
    for(const [name,size,offset] of [['aPosition',3,0],['aNormal',3,12],['aUv',2,24]]){
      gl.enableVertexAttribArray(location[name]);gl.vertexAttribPointer(location[name],size,gl.FLOAT,false,32,offset);
    }
    gl.uniformMatrix4fv(location.uModel,false,transform);gl.uniform3fv(location.uColor,color);
    gl.uniform1f(location.uTextured,textureIndex===null?0:1);gl.uniform1f(location.uMetal,metal);gl.uniform1f(location.uEmission,emission);
    if(textureIndex!==null){gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,textures.get(textureIndex)?.texture??neutralTexture);gl.uniform1i(location.uTexture,0);}
    gl.drawArrays(gl.TRIANGLES,0,geometry.count);drawCalls++;triangles+=geometry.count/3;
  }
  function resize() {
    const wasMobile=width<600;
    const rect=canvas.getBoundingClientRect();width=Math.max(1,rect.width);height=Math.max(1,rect.height);
    if(wasMobile!==(width<600)){frameIntervals.length=0;cpuTimes.length=0;previousRaf=0;wasAnimating=false;}
    dpr=Math.min(window.devicePixelRatio||1,width<600?1.25:1.5);
    const w=Math.round(width*dpr),h=Math.round(height*dpr);
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  }
  function album(x,y,z,ry,rz,scale,art) {
    const m=model(x,y,z,-.025,ry,rz,scale);
    draw(meshes.frame,m,gold,{metal:.95});
    draw(meshes.jacket,m,dark,{metal:.65});
    draw(meshes.art,m,[1,1,1],{textureIndex:art,metal:.045,emission:.16});
  }
  function getStats() {
    const mean=values=>values.length?Math.round(values.reduce((sum,n)=>sum+n,0)/values.length*100)/100:null;
    const averageFrameMs=mean(frameIntervals);
    return {available:true,renderer:'WebGL 1 natif',drawCalls,triangles,frames,dpr,width:Math.round(width),height:Math.round(height),
      texturesReady:textureStates.filter(x=>x==='ready').length,textureStates:[...textureStates],textureCache:textures.size,maxTextures:MAX_TEXTURES,maxTextureEdge:MAX_TEXTURE_EDGE,motion:enabled,inView,contextLost:lost,index,
      running:enabled&&inView&&!document.hidden&&!lost&&!disposed,fpsLimit:width<600?30:60,averageFrameMs,averageCpuMs:mean(cpuTimes),
      estimatedFps:averageFrameMs?Math.round(1000/averageFrameMs):null,timingSamples:frameIntervals.length};
  }
  function publishStats() { canvas.dataset.sceneStats=JSON.stringify(getStats()); }
  function render(now=0) {
    frame=0;if(disposed||lost)return;
    if(!inView||document.hidden){wasAnimating=false;publishStats();return;}
    resize();
    const animate=enabled&&inView&&!document.hidden;
    const interval=1000/(width<600?30:60);
    // RAF follows the display refresh rate; expensive drawing never exceeds this budget.
    if(animate&&lastDrawTime>0&&now-lastDrawTime<interval-.45){frame=requestAnimationFrame(render);return;}
    const cpuStart=performance.now();
    lastDrawTime=now;
    const delta=Math.min(.045,Math.max(0,(now-lastTime)/1000));lastTime=now;
    if(enabled&&inView&&!document.hidden)elapsed+=delta;
    if(animate&&wasAnimating&&previousRaf>0&&now>previousRaf&&now-previousRaf<250){
      frameIntervals.push(now-previousRaf);if(frameIntervals.length>60)frameIntervals.shift();
    }
    previousRaf=now;wasAnimating=animate;
    smoothPointer[0]+=(pointer[0]-smoothPointer[0])*(animate?.065:1);smoothPointer[1]+=(pointer[1]-smoothPointer[1])*(animate?.065:1);
    if(transition<1)transition=Math.min(1,transition+(animate?delta*2.2:1));
    const breath=enabled?Math.sin(elapsed*.63):0;
    const modeShift=currentMode==='hero'?0:.1;
    const pX=smoothPointer[0],pY=smoothPointer[1];
    const camera=[eye[0]+pX*.15,eye[1]-pY*.1,eye[2]];
    const aspect=width/height;
    const fov=(aspect<.9?42:43)*Math.PI/180;
    const projection=perspective(fov,aspect,.1,50),view=lookAt(camera,[0,.04+modeShift,0]);
    gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);
    gl.uniformMatrix4fv(location.uViewProjection,false,multiply(projection,view));gl.uniform3fv(location.uEye,camera);
    drawCalls=0;triangles=0;
    const plateau=model(0,-1.68,0,0,0,0,1);
    draw(meshes.base,plateau,ink,{metal:.72});
    draw(meshes.top,model(0,-1.523,0),[.025,.028,.034],{metal:.65});
    draw(meshes.ring,model(0,-1.53,0),gold,{metal:1,emission:.1});
    draw(meshes.ring,model(0,-1.78,0),gold,{metal:.8,emission:.025});
    draw(meshes.inner,model(0,-1.50,0),[.39,.27,.12],{metal:.8});
    draw(meshes.groove,model(0,-1.503,0),[.28,.23,.15],{metal:.6});
    const centerIndex=transition<.5?previousIndex:index;
    const left=(index+ARTWORKS.length-1)%ARTWORKS.length,right=(index+1)%ARTWORKS.length;
    const sideX=aspect<.9?2.45:2.62;
    album(-sideX,.10+Math.sin(elapsed*.57+1)*.065,-.63,.38+pX*.035+Math.sin(elapsed*.31+1)*.05,-.115+Math.sin(elapsed*.27+1)*.025,.84,left);
    album(sideX,.18+Math.sin(elapsed*.62+2)*.065,-.85,-.43+pX*.035+Math.sin(elapsed*.33+2)*.05,.09+Math.sin(elapsed*.25+2)*.025,.84,right);
    const flip=transition<1?(transition<.5?transition*Math.PI:(transition-1)*Math.PI):0;
    const intro=Math.sin(transition*Math.PI)*.13;
    album(pX*.075, .33+breath*.075-scroll*.09,.74+intro,-.075+pX*.055+Math.sin(elapsed*.29)*.05+flip,-.015+pY*.02+Math.sin(elapsed*.25)*.024,1,centerIndex);
    // Quelques facettes en suspension : de véritables petits volumes, pas un effet de pluie.
    for(let i=0;i<7;i++) {
      const a=i*2.399+elapsed*.055,r=3.1+(i%3)*.28;
      const x=Math.cos(a)*r,z=Math.sin(a)*1.4-1.2,y=.3+(i%4)*.56+Math.sin(elapsed*.6+i)*.075;
      const size=.016+(i%3)*.009;
      draw(meshes.diamond,model(x,y,z,elapsed*.11+i,a,elapsed*.09,size),[.83,.62,.28],{metal:1,emission:.22});
    }
    frames++;markReady();
    cpuTimes.push(performance.now()-cpuStart);if(cpuTimes.length>60)cpuTimes.shift();
    if(frames===1||frames%30===0||!animate)publishStats();
    if(animate||transition<1)frame=requestAnimationFrame(render);
  }
  function requestRender() { if(!frame&&!disposed&&!lost)frame=requestAnimationFrame(render); }
  const onResize=()=>{lastDrawTime=0;requestRender();},onVisibility=()=>{
    lastTime=performance.now();lastDrawTime=0;wasAnimating=false;
    if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0;}
    publishStats();if(!document.hidden&&enabled)requestRender();
  };
  const onLost=(event)=>{event.preventDefault();lost=true;if(frame)cancelAnimationFrame(frame);frame=0;publishStats();fail(new Error('Contexte WebGL interrompu ; aperçu statique disponible.'));};
  window.addEventListener('resize',onResize,{passive:true});document.addEventListener('visibilitychange',onVisibility);canvas.addEventListener('webglcontextlost',onLost);
  const observer=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=>{
    inView=entries[0]?.isIntersecting??true;lastTime=performance.now();lastDrawTime=0;wasAnimating=false;
    if(inView){if(enabled||frames===0)requestRender();}else{if(frame)cancelAnimationFrame(frame);frame=0;publishStats();}
  },{threshold:.02}):null;
  observer?.observe(canvas);
  requestRender();
  return {
    setIndex(value){const next=((Math.round(Number(value)||0)%ARTWORKS.length)+ARTWORKS.length)%ARTWORKS.length;if(next===index)return;previousIndex=index;index=next;transition=enabled?0:1;lastDrawTime=0;prepareArtwork();requestRender();},
    setMode(value){currentMode=String(value);requestRender();},
    setMotion(value){
      enabled=Boolean(value)&&!reducedMotion;lastTime=performance.now();lastDrawTime=0;wasAnimating=false;
      if(!enabled&&frame){cancelAnimationFrame(frame);frame=0;}
      publishStats();if(enabled||frames===0)requestRender();
    },
    setPointer(x,y){pointer=[Math.max(-1,Math.min(1,Number(x)||0)),Math.max(-1,Math.min(1,Number(y)||0))];if(enabled&&inView&&!document.hidden)requestRender();},
    setScroll(value){scroll=Math.max(0,Math.min(1,Number(value)||0));if(enabled&&inView&&!document.hidden)requestRender();},
    getStats,
    dispose(){disposed=true;for(const item of textures.values()){if(item.image){item.image.onload=null;item.image.onerror=null;}}if(frame)cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('resize',onResize);document.removeEventListener('visibilitychange',onVisibility);canvas.removeEventListener('webglcontextlost',onLost);for(const b of resources.buffers)gl.deleteBuffer(b);for(const t of resources.textures)gl.deleteTexture(t);for(const s of resources.shaders)gl.deleteShader(s);gl.deleteProgram(program);try{gl.getExtension('WEBGL_lose_context')?.loseContext();}catch{}},
  };
}

