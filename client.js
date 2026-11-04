import * as THREE from "three";

const $ = id => document.getElementById(id);
const menu = $("menu"), hud = $("hud"), playButton = $("playButton");
let scene, camera, renderer, clock, socket, myId = null, me = null;
let started = false, locked = false, yaw = 0, pitch = 0, health = 100;
let velocityY = 0, onGround = true, firing = false, lastShot = 0;
const keys = {}, remotes = new Map(), bolts = [], hitMarkers = [];
const arena = { half: 24 };
let moveStick = { x: 0, y: 0 };

function connect() {
  // GitHub Pages is static hosting: set window.VOXEL_STRIKE_SERVER in config.js
  // to your separately hosted Node.js WebSocket server, e.g. "wss://your-server.example".
  const configured = window.VOXEL_STRIKE_SERVER || "";
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const endpoint = configured.trim() || `${scheme}://${location.host}`;
  try {
    socket = new WebSocket(endpoint);
  } catch (error) {
    $("connection").textContent = "SERVER URL ERROR";
    showFeed("Set the multiplayer server URL in config.js");
    return;
  }
  socket.onopen = () => $("connection").textContent = "ONLINE";
  socket.onclose = () => $("connection").textContent = "RECONNECTING";
  socket.onerror = () => $("connection").textContent = "CONNECTION ERROR";
  socket.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.type === "welcome") {
      myId = msg.id; me = msg.player; health = 100;
      socket.send(JSON.stringify({ type: "name", name: $("playerName").value }));
      $("teamLabel").textContent = `${me.team.toUpperCase()} TEAM`;
      $("teamLabel").style.color = me.team === "blue" ? "#62bde4" : "#f2a35d";
    }
    if (msg.type === "state") updatePlayers(msg);
    if (msg.type === "tagEffect") {
      if (msg.from === myId) showFeed("TAG CONFIRMED");
      if (msg.to === myId) { health = Math.max(0, health - msg.amount); updateHealth(); }
    }
    if (msg.type === "roundEnd") {
      $("roundOverlay").textContent = `${msg.winner.toUpperCase()} TEAM WINS`;
      $("roundOverlay").classList.remove("hidden");
      setTimeout(() => $("roundOverlay").classList.add("hidden"), 2400);
    }
  };
}

function init3D() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8eb4bf);
  scene.fog = new THREE.Fog(0x8eb4bf, 35, 85);
  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, .1, 150);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $("game").appendChild(renderer.domElement);
  clock = new THREE.Clock();

  scene.add(new THREE.HemisphereLight(0xe3f4f7, 0x43505a, 2.1));
  const sun = new THREE.DirectionalLight(0xffe6c5, 2.2);
  sun.position.set(-15, 30, 12); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); scene.add(sun);

  const mat = (color, roughness=1) => new THREE.MeshStandardMaterial({ color, roughness });
  const block = (x,y,z,sx,sy,sz,color, cast=true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz), mat(color));
    mesh.position.set(x,y,z); mesh.castShadow = cast; mesh.receiveShadow = true; scene.add(mesh); return mesh;
  };

  // Ground and perimeter walls.
  block(0,-.6,0,52,1,52,0x64766e,false);
  for (let i=-24;i<=24;i+=2) {
    block(i,-.02,-25.5,1.9,.18,.8, i%4?0x9caa91:0xb6b99d,false);
    block(i,-.02,25.5,1.9,.18,.8, i%4?0x9caa91:0xb6b99d,false);
  }
  block(0,2,-26,52,5,1,0x65747a); block(0,2,26,52,5,1,0x65747a);
  block(-26,2,0,1,5,52,0x65747a); block(26,2,0,1,5,52,0x65747a);

  // Original compact urban-industrial voxel arena.
  const palette = [0x87969a,0x697b83,0xb18c68,0x7c8b78,0x536873];
  for(let i=0;i<34;i++){
    const x = (Math.random()-.5)*42, z=(Math.random()-.5)*42;
    if(Math.abs(x)<5 && Math.abs(z)<5) continue;
    const w=2+Math.floor(Math.random()*3), h=1.5+Math.floor(Math.random()*4), d=2+Math.floor(Math.random()*3);
    block(x,h/2,z,w,h,d,palette[i%palette.length]);
    if(i%3===0) block(x,h+.18,z,w*.7,.35,d*.7,0x394b53);
  }
  // Central cover, side lanes, ramps represented as voxel steps.
  block(0,1.1,0,5,2.2,3,0x8c9b9d);
  block(-8,.8,0,2,1.6,7,0x9a805f); block(8,.8,0,2,1.6,7,0x9a805f);
  for(let n=0;n<4;n++){block(-17+n*1.2,.35+n*.35,-8,2,.7+n*.7,2,0x75868b);block(17-n*1.2,.35+n*.35,8,2,.7+n*.7,2,0x75868b);}
  // Industrial structures.
  for(const side of [-1,1]){
    block(side*18,3,0,5,6,7,0x596b70);
    for(let y=0;y<3;y++) block(side*18,1.2+y*1.8,3.56,3,.7,.2,0xb18c68);
    block(side*18,6.4,0,6,.5,8,0x35474e);
  }
  // Voxel details / crates.
  for(let i=0;i<18;i++){
    const x=(Math.random()-.5)*38,z=(Math.random()-.5)*38;
    if(Math.abs(x)<5&&Math.abs(z)<5) continue;
    block(x,.65,z,1.3,1.3,1.3,i%2?0x9b754f:0x6b7778);
  }

  // First-person stylised pulse tool, not a realistic firearm model.
  const hand = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.BoxGeometry(.24,.24,.8), mat(0x34434a));
  arm.position.set(.38,-.34,-.52); hand.add(arm);
  const emitter = new THREE.Mesh(new THREE.BoxGeometry(.3,.25,.55), mat(0x80c9d6));
  emitter.position.set(.38,-.26,-.85); hand.add(emitter);
  const glow = new THREE.PointLight(0x65d9ff, .7, 2); glow.position.set(.38,-.25,-1.1); hand.add(glow);
  camera.add(hand); scene.add(camera);

  window.addEventListener("resize", onResize);
  renderer.domElement.addEventListener("click", () => { if(started && !isTouch()) renderer.domElement.requestPointerLock(); });
  document.addEventListener("pointerlockchange", () => locked = document.pointerLockElement === renderer.domElement);
  document.addEventListener("mousemove", e => {
    if(!locked) return;
    yaw -= e.movementX*.0022; pitch -= e.movementY*.0022;
    pitch = Math.max(-1.25,Math.min(1.25,pitch));
  });
  document.addEventListener("keydown", e => { keys[e.code]=true; if(e.code==="Space") e.preventDefault(); });
  document.addEventListener("keyup", e => keys[e.code]=false);
  document.addEventListener("mousedown", e => { if(e.button===0 && started) fire(); });
  document.addEventListener("mouseup", e => { if(e.button===0) firing=false; });
  animate();
}

function onResize(){ if(!camera||!renderer)return; camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight); }
function isTouch(){ return matchMedia("(pointer: coarse)").matches || innerWidth<800; }

function makeAvatar(team) {
  const group = new THREE.Group();
  const color = team==="blue"?0x4aaed6:0xe28c4c;
  const body = new THREE.Mesh(new THREE.BoxGeometry(.8,1.05,.48),new THREE.MeshStandardMaterial({color}));
  body.position.y=.95; body.castShadow=true; group.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(.62,.62,.62),new THREE.MeshStandardMaterial({color:0xd1b18b}));
  head.position.y=1.78; head.castShadow=true; group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(.42,.16,.08),new THREE.MeshStandardMaterial({color:0x243a45,metalness:.4,roughness:.3}));
  visor.position.set(0,1.82,-.34); group.add(visor);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(.55,.65,.25),new THREE.MeshStandardMaterial({color:0x39474b}));
  pack.position.set(0,1.05,.34);group.add(pack);
  group.userData.body=body;
  return group;
}

function updatePlayers(state) {
  $("blueScore").textContent=state.scores.blue; $("orangeScore").textContent=state.scores.orange;
  const seen=new Set();
  for(const p of state.players){
    if(p.id===myId){ if(me){me.team=p.team; if(p.health!==health && p.health>health) health=p.health; } continue; }
    seen.add(p.id);
    let obj=remotes.get(p.id);
    if(!obj){obj=makeAvatar(p.team);scene.add(obj);remotes.set(p.id,obj);}
    obj.visible=p.alive;
    obj.position.set(p.x,p.y-1.7,p.z);
    obj.rotation.y=p.yaw;
    obj.userData.targetX=p.x;obj.userData.targetZ=p.z;
  }
  for(const [id,obj] of remotes) if(!seen.has(id)){scene.remove(obj);remotes.delete(id);}
}

function updateHealth(){ $("health").textContent=Math.max(0,health);$("healthBar").style.width=Math.max(0,health)+"%"; }
function showFeed(text){
  const node=document.createElement("div");node.textContent=text;$("feed").prepend(node);
  setTimeout(()=>node.remove(),2200);
}
function fire(){
  if(!started || !socket || socket.readyState!==WebSocket.OPEN)return;
  const now=performance.now();if(now-lastShot<240)return;lastShot=now;
  const dir=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(pitch,yaw,0,"YXZ")).normalize();
  socket.send(JSON.stringify({type:"tag",dx:dir.x,dy:dir.y,dz:dir.z}));
  const bolt=new THREE.Mesh(new THREE.SphereGeometry(.09,8,8),new THREE.MeshBasicMaterial({color:0x8eeaff}));
  bolt.position.copy(camera.position).add(dir.clone().multiplyScalar(.8));scene.add(bolt);
  bolts.push({mesh:bolt,dir,life:.18});
  const h=$("health");h.style.opacity=".7";setTimeout(()=>h.style.opacity="1",90);
}
function jump(){if(onGround){velocityY=7.5;onGround=false;}}
function sendMove(){
  if(!socket||socket.readyState!==WebSocket.OPEN||!me)return;
  socket.send(JSON.stringify({type:"move",x:camera.position.x,y:camera.position.y,z:camera.position.z,yaw,pitch}));
}

function setupMobile(){
  if(!isTouch())return;
  const stick=$("stick"),nub=$("stickNub");let active=false,origin=null;
  stick.addEventListener("pointerdown",e=>{active=true;origin={x:e.clientX,y:e.clientY};stick.setPointerCapture(e.pointerId);});
  stick.addEventListener("pointermove",e=>{if(!active)return;let dx=e.clientX-origin.x,dy=e.clientY-origin.y;const len=Math.hypot(dx,dy),scale=Math.min(1,48/(len||1));dx*=scale;dy*=scale;moveStick={x:dx/48,y:dy/48};nub.style.transform=`translate(${dx}px,${dy}px)`;});
  const release=()=>{active=false;moveStick={x:0,y:0};nub.style.transform="translate(0,0)";};
  stick.addEventListener("pointerup",release);stick.addEventListener("pointercancel",release);
  $("jumpBtn").addEventListener("pointerdown",e=>{e.preventDefault();jump();});
  $("fireBtn").addEventListener("pointerdown",e=>{e.preventDefault();fire();});
  let look=null;
  renderer.domElement.addEventListener("pointerdown",e=>{if(e.clientX>innerWidth*.35){look={x:e.clientX,y:e.clientY};}});
  renderer.domElement.addEventListener("pointermove",e=>{if(!look)return;const dx=e.clientX-look.x,dy=e.clientY-look.y;look={x:e.clientX,y:e.clientY};yaw-=dx*.004;pitch=Math.max(-1.2,Math.min(1.2,pitch-dy*.004));});
  renderer.domElement.addEventListener("pointerup",()=>look=null);
}

function animate(){
  requestAnimationFrame(animate);
  if(!renderer)return;
  const dt=Math.min(clock.getDelta(),.04);
  if(started && camera){
    camera.rotation.order="YXZ";camera.rotation.y=yaw;camera.rotation.x=pitch;
    let forward=(keys.KeyW?1:0)-(keys.KeyS?1:0)-moveStick.y;
    let side=(keys.KeyD?1:0)-(keys.KeyA?1:0)+moveStick.x;
    const len=Math.hypot(forward,side)||1;forward/=len;side/=len;
    const speed=(keys.ShiftLeft||keys.ShiftRight)?9:6;
    const moveX=(Math.sin(yaw)*forward+Math.cos(yaw)*side)*speed*dt;
    const moveZ=(-Math.cos(yaw)*forward+Math.sin(yaw)*side)*speed*dt;
    camera.position.x=THREE.MathUtils.clamp(camera.position.x+moveX,-24,24);
    camera.position.z=THREE.MathUtils.clamp(camera.position.z+moveZ,-24,24);
    if(keys.Space)jump();
    velocityY-=19*dt;camera.position.y+=velocityY*dt;
    if(camera.position.y<1.7){camera.position.y=1.7;velocityY=0;onGround=true;}
    camera.position.y=Math.min(camera.position.y,4.5);
    if(performance.now()%80<dt*1000)sendMove();
  }
  for(let i=bolts.length-1;i>=0;i--){
    const b=bolts[i];b.mesh.position.addScaledVector(b.dir,42*dt);b.life-=dt;
    if(b.life<=0){scene.remove(b.mesh);bolts.splice(i,1);}
  }
  for(const obj of remotes.values()){
    if(obj.userData.targetX!==undefined){
      obj.position.x=THREE.MathUtils.damp(obj.position.x,obj.userData.targetX,12,dt);
      obj.position.z=THREE.MathUtils.damp(obj.position.z,obj.userData.targetZ,12,dt);
    }
  }
  if(renderer)renderer.render(scene,camera);
}

playButton.addEventListener("click",()=>{
  if(started)return;
  started=true;menu.classList.add("hidden");hud.classList.remove("hidden");
  init3D();connect();setupMobile();
  if(!isTouch()) renderer.domElement.requestPointerLock?.();
});
document.addEventListener("keydown",e=>{if(e.code==="Escape"&&started)locked=false;});
