// Disposable loopback browser fixture only; the normal demo is never a seed target.
import { createServer } from "node:http";
import { startAuthApp } from "./auth-app-fixture.mjs";
import { seedP2Fixture } from "./p2-fixture.mjs";
import { cookiesOf } from "./kiosk-fixture.mjs";
const app=await startAuthApp({seed:seedP2Fixture});let server;
const close=async()=>{server?.close();server?.closeAllConnections();await app.close();process.exit(0);};
process.stdin.setEncoding("utf8");process.stdin.on("data",data=>{if(data.trim()==="close")void close();});process.once("SIGINT",close);process.once("SIGTERM",close);
try {
  const sign=async email=>{const r=await fetch(app.origin+"/api/auth/login",{method:"POST",headers:{Origin:app.origin,"Content-Type":"application/json"},body:JSON.stringify({email,password:app.password})});if(!r.ok)throw new Error();return cookiesOf(r)[0];};
  const owner=await sign(app.email),employee=await sign(app.fixtureData.employeeAccount.email);
  server=createServer((request,response)=>{const isOwner=request.url==="/owner";if(!isOwner&&request.url!=="/employee"){response.writeHead(404);response.end();return;}
    response.writeHead(303,{"Set-Cookie":[`${isOwner?owner:employee}; Path=/; HttpOnly; SameSite=Strict`,"dombase-kiosk-device=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict","dombase-kiosk-person=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"],Location:app.origin+(isOwner?"/team/reports":"/community"),"Cache-Control":"no-store"});response.end();});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));console.log(JSON.stringify({fixture:"isolated P2 reports and recognition",ownerEntry:`http://127.0.0.1:${server.address().port}/owner`,employeeEntry:`http://127.0.0.1:${server.address().port}/employee`,origin:app.origin}));
}catch{console.error("P2 preview could not start.");await close();}
