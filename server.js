const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 10000;
const HOST = "0.0.0.0";
const rooms = new Map();

const events = {
  2:{icon:"⭐",type:"BONIFICACIÓN",title:"¡Premio sorpresa!",msg:"Ganas 10 puntos.",score:10},
  4:{icon:"🚀",type:"AVANCE",title:"¡Impulso!",msg:"Avanzas 2 casillas.",move:2},
  6:{icon:"🍀",type:"CASILLA LIBRE",title:"Camino seguro",msg:"No ocurre nada. Puedes continuar."},
  8:{icon:"↩️",type:"RETROCESO",title:"¡Cuidado!",msg:"Retrocedes 2 casillas.",move:-2},
  10:{icon:"🎁",type:"BONIFICACIÓN",title:"¡Tesoro encontrado!",msg:"Ganas 20 puntos.",score:20},
  12:{icon:"🎲",type:"TURNO EXTRA",title:"¡Otra oportunidad!",msg:"Puedes volver a lanzar el dado.",extra:true},
  14:{icon:"🌀",type:"RETROCESO",title:"¡Te despistaste!",msg:"Retrocedes 1 casilla.",move:-1},
  16:{icon:"⭐",type:"BONIFICACIÓN",title:"¡Excelente!",msg:"Ganas 15 puntos.",score:15},
  18:{icon:"⏸️",type:"PENALIZACIÓN",title:"Pierdes un turno",msg:"En tu siguiente oportunidad no podrás lanzar.",skip:true},
  20:{icon:"🚀",type:"ATAJO",title:"¡Atajo secreto!",msg:"Avanzas 3 casillas.",move:3},
  22:{icon:"🍀",type:"CASILLA LIBRE",title:"Descanso seguro",msg:"No ocurre nada. Puedes continuar."},
  25:{icon:"🎁",type:"BONIFICACIÓN",title:"¡Cofre sorpresa!",msg:"Ganas 20 puntos.",score:20},
  28:{icon:"🚀",type:"AVANCE",title:"¡Último impulso!",msg:"Avanzas 1 casilla.",move:1}
};
const questionCells=[3,5,7,9,11,13,15,17,19,21,23,24,26,27,29];
const qByCell={}; questionCells.forEach((c,i)=>qByCell[c]=i);

function roomCode(){let c;do{c=Math.random().toString(36).slice(2,8).toUpperCase()}while(rooms.has(c));return c}
function cleanName(v){return String(v||"").trim().replace(/\s+/g," ").slice(0,35)}
function publicPlayers(room){return room.players.map(p=>({id:p.id,name:p.name,avatar:p.avatar,host:p.id===room.host,pos:p.pos,score:p.score,skip:p.skip,visited:p.visited}))}
function broadcast(room,msg){const data=JSON.stringify(msg);for(const p of room.players){if(p.ws.readyState===1)p.ws.send(data)}}
function configFor(room){return {title:room.config.title||"Ruta de las Palabras",theme:room.config.theme||"clasico",questions:room.config.questions||[]}}
function sendState(room){
  broadcast(room,{type:"state",started:room.started,turnIndex:room.turnIndex,players:publicPlayers(room),config:configFor(room)});
}
function advanceTurn(room){
  if(!room.players.length)return;
  room.turnIndex=(room.turnIndex+1)%room.players.length;
  room.pending=null;
}
function current(room){return room.players[room.turnIndex]}

function beginCell(room,p){
  if(p.pos===30){
    room.pending={kind:"gameover"};
    broadcast(room,{type:"gameOver",message:`${p.name} llegó a la meta con ${p.score} puntos.`});
    sendState(room); return;
  }
  if(qByCell[p.pos]!==undefined){
    room.pending={kind:"question",playerId:p.id,questionIndex:qByCell[p.pos]};
    broadcast(room,{type:"question",questionIndex:qByCell[p.pos],playerId:p.id,playerName:p.name});
    sendState(room); return;
  }
  const e=events[p.pos];
  if(!e){
    room.pending={kind:"turnEnd",playerId:p.id,extra:false};
    p.ws.send(JSON.stringify({type:"event",icon:"🛤️",eventType:"CAMINO",title:`Casilla ${p.pos}`,message:"No ocurre nada. Continúa tu recorrido.",move:0,extra:false}));
    sendState(room); return;
  }
  if(e.score)p.score+=e.score;
  if(e.skip)p.skip=true;
  room.pending={kind:"event",playerId:p.id,move:e.move||0,extra:!!e.extra};
  p.ws.send(JSON.stringify({type:"event",icon:e.icon,eventType:e.type,title:e.title,message:e.msg,move:e.move||0,extra:!!e.extra}));
  sendState(room);
}

function handle(ws,msg){
  if(!msg||typeof msg.type!=="string")return;
  if(msg.type==="createRoom"){
    const name=cleanName(msg.name); if(name.length<2)return ws.send(JSON.stringify({type:"error",message:"Escribe un nombre válido."}));
    const room= {code:roomCode(),host:null,players:[],started:false,turnIndex:0,pending:null,config:msg.config||{}};
    const p={id:Math.random().toString(36).slice(2,10),ws,name,avatar:String(msg.avatar||"🤖"),pos:1,score:0,skip:false,visited:[1]};
    room.host=p.id; room.players.push(p); rooms.set(room.code,room); ws.room=room.code; ws.playerId=p.id;
    ws.send(JSON.stringify({type:"created",room:room.code,playerId:p.id,host:true,players:publicPlayers(room)})); sendState(room); return;
  }
  if(msg.type==="joinRoom"){
    const code=String(msg.room||"").trim().toUpperCase(), name=cleanName(msg.name);
    const room=rooms.get(code);
    if(!room)return ws.send(JSON.stringify({type:"error",message:"No existe esa sala."}));
    if(room.started)return ws.send(JSON.stringify({type:"error",message:"La partida ya comenzó."}));
    if(room.players.length>=4)return ws.send(JSON.stringify({type:"error",message:"La sala ya tiene 4 jugadores."}));
    if(name.length<2)return ws.send(JSON.stringify({type:"error",message:"Escribe un nombre válido."}));
    const p={id:Math.random().toString(36).slice(2,10),ws,name,avatar:String(msg.avatar||"🤖"),pos:1,score:0,skip:false,visited:[1]};
    room.players.push(p); ws.room=code; ws.playerId=p.id;
    ws.send(JSON.stringify({type:"joined",room:code,playerId:p.id,host:false,players:publicPlayers(room)})); sendState(room); return;
  }
  const room=rooms.get(ws.room); if(!room)return ws.send(JSON.stringify({type:"error",message:"No estás en una sala."}));
  const p=room.players.find(x=>x.id===ws.playerId); if(!p)return;
  if(msg.type==="start"){
    if(p.id!==room.host)return ws.send(JSON.stringify({type:"error",message:"Solo el creador puede iniciar la partida."}));
    if(room.players.length<2)return ws.send(JSON.stringify({type:"error",message:"Se necesitan al menos 2 jugadores."}));
    room.started=true; room.turnIndex=0; room.pending=null; sendState(room); return;
  }
  if(msg.type==="roll"){
    if(!room.started)return;
    const cur=current(room); if(!cur||cur.id!==p.id)return ws.send(JSON.stringify({type:"error",message:"No es tu turno."}));
    if(room.pending)return ws.send(JSON.stringify({type:"error",message:"Primero termina la acción actual."}));
    if(p.skip){p.skip=false; room.pending={kind:"skip",playerId:p.id}; p.ws.send(JSON.stringify({type:"skipTurn"})); sendState(room); return;}
    const value=1+Math.floor(Math.random()*6);
    p.pos=Math.min(30,p.pos+value); if(!p.visited.includes(p.pos))p.visited.push(p.pos);
    broadcast(room,{type:"rolled",value,playerName:p.name}); beginCell(room,p); return;
  }
  if(msg.type==="answer"){
    if(!room.started||!room.pending||room.pending.kind!=="question"||room.pending.playerId!==p.id)return;
    const q=(room.config.questions||[])[room.pending.questionIndex]; if(!q)return;
    const idx=Number(msg.index); const correct=idx===Number(q.a);
    if(correct)p.score+=20; else p.score=Math.max(0,p.score-1);
    broadcast(room,{type:"answerResult",correct,questionIndex:room.pending.questionIndex,playerId:p.id,playerName:p.name});
    room.pending={kind:"questionAnswered",playerId:p.id};
    sendState(room); return;
  }
  if(msg.type==="continueQuestion"){
    if(room.pending?.kind!=="questionAnswered"||room.pending.playerId!==p.id)return;
    advanceTurn(room);
    // Tell every connected player to close the question overlay and continue.
    broadcast(room,{type:"turnAdvanced",turnIndex:room.turnIndex});
    sendState(room);
    return;
  }
  if(msg.type==="continueEvent"){
    if(!room.pending||room.pending.playerId!==p.id)return;
    const pending=room.pending;
    if(pending.move){p.pos=Math.max(1,Math.min(30,p.pos+pending.move));if(!p.visited.includes(p.pos))p.visited.push(p.pos);}
    if(p.pos===30){room.pending={kind:"gameover"};broadcast(room,{type:"gameOver",message:`${p.name} llegó a la meta con ${p.score} puntos.`});sendState(room);return;}
    if(pending.extra){room.pending=null;sendState(room);return;}
    advanceTurn(room); sendState(room); return;
  }
  if(msg.type==="reset"){
    if(p.id!==room.host)return ws.send(JSON.stringify({type:"error",message:"Solo el creador puede reiniciar la partida."}));
    for(const x of room.players){x.pos=1;x.score=0;x.skip=false;x.visited=[1];}
    room.turnIndex=0;room.pending=null;room.started=true;sendState(room);return;
  }
  if(msg.type==="leave"){ws.close();return;}
}

const server=http.createServer((req,res)=>{
  let file=req.url.split("?")[0];
  if(file==="/"||file==="")file="/index.html";
  const filePath=path.join(__dirname,"public",path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, ""));
  if(!filePath.startsWith(path.join(__dirname,"public")))return res.writeHead(403).end();
  fs.readFile(filePath,(err,data)=>{
    if(err)return res.writeHead(404).end("Not found");
    const ext=path.extname(filePath); const type={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"}[ext]||"application/octet-stream";
    res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-cache"});res.end(data);
  });
});
const wss=new WebSocketServer({server});
wss.on("connection",ws=>{
  ws.on("message",raw=>{try{handle(ws,JSON.parse(raw.toString()))}catch(e){console.error(e);ws.send(JSON.stringify({type:"error",message:"Error del servidor."}))}});
  ws.on("close",()=>{
    const room=rooms.get(ws.room); if(!room)return;
    const idx=room.players.findIndex(p=>p.id===ws.playerId);
    if(idx<0)return;
    const wasTurn=idx===room.turnIndex;
    room.players.splice(idx,1);
    if(!room.players.length){rooms.delete(room.code);return;}
    if(ws.playerId===room.host)room.host=room.players[0].id;
    if(idx<room.turnIndex)room.turnIndex--;
    if(room.turnIndex>=room.players.length)room.turnIndex=0;
    if(wasTurn)room.pending=null;
    sendState(room);
  });
});
server.listen(PORT,HOST,()=>console.log(`Ruta de las Palabras online en ${HOST}:${PORT}`));
