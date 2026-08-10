const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
} as const;

export function setupHtml(): Response {
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Spliit MCP setup</title>
<style>body{font:16px system-ui;max-width:720px;margin:3rem auto;padding:0 1rem;color:#17202a}form{display:grid;gap:.75rem;padding:1rem;background:#f4f6f7;border-radius:12px}label{display:grid;gap:.25rem}input,button{font:inherit;padding:.65rem}button{cursor:pointer}.row{display:flex;gap:.5rem;align-items:center}.row span{flex:1}li{margin:.6rem 0}#status{min-height:1.5rem}.danger{color:#922b21}</style>
</head><body><h1>Spliit MCP setup</h1>
<p>Add group links here so they never pass through an AI prompt. The admin token stays in this tab's memory and is not saved.</p>
<form id="group-form">
<label>Admin token<input id="token" type="password" autocomplete="off" required></label>
<label>Safe alias<input id="alias" pattern="[a-z][a-z0-9_-]*" maxlength="40" required placeholder="holiday"></label>
<label>Spliit group URL<input id="url" type="url" required placeholder="https://spliit.app/groups/…"></label>
<label>Your participant ID (optional)<input id="participant" maxlength="200"></label>
<div class="row"><button type="submit">Add or update group</button><button type="button" id="refresh">Refresh list</button></div>
</form>
<p id="status" role="status"></p><h2>Remembered groups</h2><ul id="groups"></ul>
<script src="/setup.js"></script></body></html>`,
    { headers: { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8" } }
  );
}

export function setupJavaScript(): Response {
  return new Response(
    `"use strict";
const byId=(id)=>document.getElementById(id);const status=byId("status");
const token=()=>byId("token").value;
async function api(path,init={}){const headers=new Headers(init.headers);headers.set("Authorization","Bearer "+token());if(init.body)headers.set("Content-Type","application/json");const response=await fetch(path,{...init,headers});const body=await response.json();if(!response.ok)throw new Error(body.error||("HTTP "+response.status));return body;}
function message(text,error=false){status.textContent=text;status.className=error?"danger":"";}
async function refresh(){try{const result=await api("/admin/groups");const list=byId("groups");list.replaceChildren();for(const group of result.groups){const item=document.createElement("li");const row=document.createElement("div");row.className="row";const name=document.createElement("span");name.textContent=group.alias+(group.active?" (active)":"");const select=document.createElement("button");select.textContent="Select";select.disabled=group.active;select.onclick=async()=>{await api("/admin/groups/"+encodeURIComponent(group.alias)+"/select",{method:"POST"});await refresh();};const remove=document.createElement("button");remove.textContent="Remove";remove.onclick=async()=>{if(confirm("Remove "+group.alias+" and all pending drafts?")){await api("/admin/groups/"+encodeURIComponent(group.alias),{method:"DELETE"});await refresh();}};row.append(name,select,remove);item.append(row);list.append(item);}message(result.groups.length?"Group list loaded.":"No groups remembered yet.");}catch(error){message(error.message,true);}}
byId("group-form").addEventListener("submit",async(event)=>{event.preventDefault();try{const participant=byId("participant").value.trim();const body={alias:byId("alias").value.trim(),url:byId("url").value.trim(),...(participant?{participantId:participant}:{})};const result=await api("/admin/groups",{method:"POST",body:JSON.stringify(body)});byId("url").value="";message("Saved "+result.alias+" ("+result.name+").");await refresh();}catch(error){message(error.message,true);}});
byId("refresh").addEventListener("click",refresh);`,
    { headers: { ...SECURITY_HEADERS, "Content-Type": "text/javascript; charset=utf-8" } }
  );
}
