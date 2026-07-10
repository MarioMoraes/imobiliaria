const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/typescript-CmGuhDT8.js","assets/index-h88hfJEs.js","assets/index-Bl0F853c.css","assets/_commonjs-dynamic-modules-TDtrdbi3.js"])))=>i.map(i=>d[i]);
import{ac as Ht}from"./index-h88hfJEs.js";const k=/^src\/App\.(jsx?|tsx?)$/i,Zt=/^src\/(?:main|index)\.(jsx?|tsx?)$/i,pt=/^src\/pages\/(.+)\.(jsx?|tsx?)$/i,Vt=/^pages\/(.+)\.(jsx?|tsx?)$/i,ut=/^app(?:\/(.+))?\/page\.(jsx?|tsx?)$/i,B=["src/index.css","src/App.css","src/app.css","src/global.css","src/globals.css","app/globals.css"],E="src/__aura_page_preview__.jsx",Jt=new Set(["_app","_document","_error"]),dt=[/from\s+["']react-router-dom["']/,/\bBrowserRouter\b/,/\bHashRouter\b/,/\bRouterProvider\b/,/\bcreateBrowserRouter\b/,/\bRoutes\b/,/\bRoute\b/],Z=/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/g,V=/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:React\.)?lazy\(\s*\(\s*\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)\s*\)/g,Kt=[/import\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["'];?/g,/export\s+[^"'`]*?\s+from\s+["']([^"']+)["'];?/g,/import\s*\(\s*["']([^"']+)["']\s*\)/g,/require\(\s*["']([^"']+)["']\s*\)/g],J=/<Route\b(?:[^"'>{}]|"[^"]*"|'[^']*'|{[\s\S]*?})*(?:\/>|>[\s\S]*?<\/Route>)/g,Yt=/\bpath\s*=\s*["']([^"']+)["']/,Qt=/\belement\s*=\s*{\s*<([A-Za-z_$][\w$]*)\b/,ht=/\bComponent\s*=\s*{\s*([A-Za-z_$][\w$]*)\s*}/,K=/{[\s\S]*?\bpath\s*:\s*["']([^"']+)["'][\s\S]*?\belement\s*:\s*<([A-Za-z_$][\w$]*)\b[\s\S]*?}/g,qt=[/\bBrowserRouter\b/,/\bHashRouter\b/,/\bRouterProvider\b/,/\bcreateBrowserRouter\b/],_=e=>{const t=[],n=a=>{if(a.type==="file"){t.push(a);return}a.children.forEach(n)};return e.forEach(n),t},W=e=>e.replace(/\.(jsx?|tsx?)$/i,""),te=e=>e.replace(/\[(.+?)\]/g,"$1").replace(/[^a-zA-Z0-9/_-]+/g,"").replace(/\/+/g,"/").replace(/^-+|-+$/g,"").toLowerCase(),F=e=>{const n=W(e).replace(/\\/g,"/").split("/").filter(Boolean);if(n.length===0)return"/";const a=n.filter((s,r,o)=>{const i=s.toLowerCase();return!(i==="index"||o.length===1&&i==="home")});return a.length===0?"/":`/${a.map(te).join("/")}`},I=e=>{const t=C(e||"/");if(t==="/")return"/";const[n,a=""]=t.split(/(?=[?#])/,2),s=n.replace(/\/+/g,"/").replace(/\/$/,"")||"/";if(s==="/")return"/";const r=s.replace(/^\//,"").split("/"),o=r.length-1;return o>=0&&(r[o]=r[o].replace(/\.html?$/i,"")),`${`/${r.filter(Boolean).join("/")}`||"/"}${a}`},j=(e,t,n)=>{if(!t.startsWith("."))return null;const a=e.split("/").slice(0,-1),s=t.split("/"),r=[...a];s.forEach(c=>{if(!(!c||c===".")){if(c===".."){r.pop();return}r.push(c)}});const o=r.join("/").replace(/\\/g,"/");return(o.match(/\.(jsx?|tsx?)$/i)?[o]:[`${o}.js`,`${o}.jsx`,`${o}.ts`,`${o}.tsx`,`${o}/index.js`,`${o}/index.jsx`,`${o}/index.ts`,`${o}/index.tsx`]).find(c=>n.has(c))||null},ee=(e,t,n)=>{const a=new Set;return Kt.forEach(s=>{s.lastIndex=0;let r=null;for(;(r=s.exec(t))!==null;){const[,o]=r;if(!(o!=null&&o.startsWith(".")))continue;const i=j(e,o,n);i&&a.add(i)}}),[...a]},mt=(e,t)=>{const n=_(t).filter(i=>/\.(jsx?|tsx?)$/i.test(i.path)),a=new Set(n.map(i=>i.path)),s=new Map(n.map(i=>[i.path,i.content]));if(!a.has(e))return!1;const r=[e],o=new Set;for(;r.length>0;){const i=r.pop();if(!i||o.has(i))continue;o.add(i);const c=s.get(i);if(c){if(qt.some(l=>l.test(c)))return!0;ee(i,c,a).forEach(l=>{o.has(l)||r.push(l)})}}return!1},ne=e=>ut.test(e)?"app":pt.test(e)?"src-pages":"pages",ft=e=>/^[A-Za-z_$][\w$]*$/.test(e),se=e=>{const t=e.replace(/^type\s+/,"").trim(),n=t.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);return n?n[2]:ft(t)?t:null},re=(e,t,n)=>{var r;const a=new Map;let s=null;for(Z.lastIndex=0;(s=Z.exec(t))!==null;){const[,o,i]=s,c=j(e,i,n);if(!c)continue;const l=o.trim();if(l.startsWith("type "))continue;const p=l.match(/{([\s\S]*?)}/),u=(r=l.split(",")[0])==null?void 0:r.trim().replace(/^type\s+/,"");u&&!u.startsWith("{")&&!u.startsWith("*")&&ft(u)&&a.set(u,c),p&&p[1].split(",").map(d=>se(d)).filter(d=>!!d).forEach(d=>{a.set(d,c)})}for(V.lastIndex=0;(s=V.exec(t))!==null;){const[,o,i]=s,c=j(e,i,n);c&&a.set(o,c)}return a},C=e=>{const t=e.trim();return!t||t==="index"?"/":t.startsWith("/")?t:`/${t}`},ae=(e,t)=>{const n=e.match(/\belement\s*=\s*{\s*([\s\S]*?)\s*}/),a=e.match(ht);return((n==null?void 0:n[1])||(a==null?void 0:a[0])||t).replace(/\s+/g," ").trim()},oe=e=>{const t=new Map;e.forEach(a=>{if(a.isImportedComponent)return;const s=[a.routeOwnerFilePath,a.componentFilePath,a.componentName,a.elementSignature].join("|");t.set(s,[...t.get(s)||[],a])});const n=new Set;return t.forEach(a=>{if(a.length<=1)return;const s=a.find(r=>r.routePath==="/")||a[0];a.forEach(r=>{r!==s&&n.add(r)})}),e.filter(a=>!n.has(a))},ie=e=>{const t=new Set(e.map(s=>s.path)),n=new Map,a=[];return e.forEach(s=>{var i,c,l;if(!/\.(jsx?|tsx?)$/i.test(s.path)||!dt.some(p=>p.test(s.content)))return;const r=re(s.path,s.content,t);let o=null;for(J.lastIndex=0;(o=J.exec(s.content))!==null;){const[p]=o,u=(i=p.match(Yt))==null?void 0:i[1],d=((c=p.match(Qt))==null?void 0:c[1])||((l=p.match(ht))==null?void 0:l[1]),m=u?C(u):null;if(!m||!d||m.includes(":")||m.includes("*"))continue;const h=r.get(d)||null,f=h||(t.has(s.path)?s.path:null);f&&a.push({routePath:m,componentName:d,componentFilePath:f,routeOwnerFilePath:s.path,elementSignature:ae(p,d),isImportedComponent:!!h})}for(K.lastIndex=0;(o=K.exec(s.content))!==null;){const[,p,u]=o,d=p?C(p):null;if(!d||!u||d.includes(":")||d.includes("*"))continue;const m=r.get(u)||null,h=m||(t.has(s.path)?s.path:null);h&&a.push({routePath:d,componentName:u,componentFilePath:h,routeOwnerFilePath:s.path,elementSignature:u,isImportedComponent:!!m})}}),oe(a).forEach(s=>{const r=n.get(s.componentFilePath)||[];r.includes(s.routePath)||n.set(s.componentFilePath,[...r,s.routePath])}),n},gt=(e,t)=>{if(e==="/")return"Home";const n=e.replace(/^\//,"").split("/").filter(Boolean).map(a=>a.replace(/[-_]+/g," ").replace(/\b\w/g,s=>s.toUpperCase())).join(" / ");return n||W(t.split("/").pop()||t)},ce={"src-pages":3,pages:2,app:1},Y=e=>{const t=I(e.routePath);let n=ce[e.kind]*10;return e.routePath===t&&(n+=5),e.isDefault&&(n+=1),n},T=(e,t)=>{const n=e.split("/").slice(0,-1),a=t.split("/");for(;n.length>0&&a.length>0&&n[0]===a[0];)n.shift(),a.shift();const r=[...new Array(n.length).fill(".."),...a].join("/");return!r||r===""?"./":r.startsWith(".")?r:`./${r}`},le=(e,t)=>{const n=T(E,e.previewFilePath),a=B.filter(s=>t.has(s)).map(s=>`import "${T(E,s)}";`).join(`
`);return`import React from "react";
import { MemoryRouter } from "react-router-dom";
import * as PageModule from "${n}";
${a}

const resolvedPagePath = ${JSON.stringify(e.routePath)};
const previewRouterFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};
const resolvedPageModule =
  PageModule.default ||
  Object.values(PageModule).find((value) => typeof value === "function");

const FallbackPage = () => (
  <div style={{ padding: "24px", fontFamily: "Inter, sans-serif" }}>
    The selected page file does not export a React component.
  </div>
);

const PreviewPage = resolvedPageModule || FallbackPage;

export default function AuraPagePreview() {
  React.useEffect(() => {
    try {
      window.history.replaceState({}, "", resolvedPagePath);
    } catch (error) {
      console.warn("Unable to set preview path", error);
    }
  }, []);

  return (
    <MemoryRouter
      initialEntries={[resolvedPagePath]}
      future={previewRouterFuture}
    >
      <PreviewPage />
    </MemoryRouter>
  );
}`},Rt=(e,t,n)=>{const a=T(E,e),s=B.filter(r=>t.has(r)).map(r=>`import "${T(E,r)}";`).join(`
`);return`import React from "react";
${n?'import { BrowserRouter } from "react-router-dom";':""}
import * as AppModule from "${a}";
${s}

const PREVIEW_SANDBOX_PATH = "/preview-sandbox-v2.html";
const previewRouterFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};
const getCurrentBrowserPath = () =>
  \`\${window.location.pathname || "/"}\${window.location.search || ""}\${window.location.hash || ""}\`;
const normalizePreviewPath = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return "/";
  }

  const trimmedValue = value.trim();
  return trimmedValue.startsWith("/") ? trimmedValue : \`/\${trimmedValue}\`;
};
const resolvedPagePath = (() => {
  const browserPath = getCurrentBrowserPath();
  if (browserPath && browserPath !== PREVIEW_SANDBOX_PATH) {
    return browserPath;
  }

  return normalizePreviewPath(window.__AURA_PREVIEW_ROUTE_PATH || "/");
})();
const resolvedAppModule =
  AppModule.default ||
  Object.values(AppModule).find((value) => typeof value === "function");

try {
  if (getCurrentBrowserPath() !== resolvedPagePath) {
    window.history.replaceState({}, "", resolvedPagePath);
  }
} catch (error) {
  console.warn("Unable to set preview path", error);
}

const FallbackApp = () => (
  <div style={{ padding: "24px", fontFamily: "Inter, sans-serif" }}>
    The routed app entry does not export a React component.
  </div>
);

const PreviewApp = resolvedAppModule || FallbackApp;

export default function AuraRoutePreview() {
  const app = <PreviewApp />;

  ${n?"return <BrowserRouter future={previewRouterFuture}>{app}</BrowserRouter>;":"return app;"}
}
`},pe=(e,t)=>{const n=[],a=[];e.forEach((r,o)=>{if(!t.has(r.previewFilePath))return;const i=`PageModule${o}`;n.push(`import * as ${i} from "${T(E,r.previewFilePath)}";`),a.push(`${JSON.stringify(r.routePath)}: ${i}`)});const s=B.filter(r=>t.has(r)).map(r=>`import "${T(E,r)}";`).join(`
`);return`import React from "react";
import { MemoryRouter } from "react-router-dom";
${n.join(`
`)}
${s}

const previewRouterFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};
const ROUTE_MODULES = {
  ${a.join(`,
  `)}
};
const normalizeRoutePath = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return "/";
  }

  try {
    const parsed = new URL(value, window.location.origin);
    const normalizedPathname =
      parsed.pathname.replace(/\\/+/g, "/").replace(/\\/$/, "") || "/";

    return \`\${normalizedPathname}\${parsed.search}\${parsed.hash}\`;
  } catch (error) {
    const trimmedValue = value.trim();
    return trimmedValue.startsWith("/") ? trimmedValue : \`/\${trimmedValue}\`;
  }
};
const getCurrentRoutePath = () =>
  normalizeRoutePath(
    window.location.pathname ||
      window.__AURA_PREVIEW_ROUTE_PATH ||
      "/",
  );
const resolveRouteModule = (routePath) => {
  if (ROUTE_MODULES[routePath]) {
    return ROUTE_MODULES[routePath];
  }

  if (ROUTE_MODULES["/"]) {
    return ROUTE_MODULES["/"];
  }

  return Object.values(ROUTE_MODULES)[0] || null;
};
const resolveRenderableModule = (moduleValue) =>
  moduleValue?.default ||
  Object.values(moduleValue || {}).find((value) => typeof value === "function");

const FallbackPage = () => (
  <div style={{ padding: "24px", fontFamily: "Inter, sans-serif" }}>
    The current route could not be resolved in this published preview.
  </div>
);

export default function AuraPublishedPagePreview() {
  const resolvedRoutePath = getCurrentRoutePath();
  const resolvedPageModule = resolveRouteModule(resolvedRoutePath);
  const PreviewPage = resolveRenderableModule(resolvedPageModule) || FallbackPage;

  return (
    <MemoryRouter
      initialEntries={[resolvedRoutePath]}
      future={previewRouterFuture}
    >
      <PreviewPage />
    </MemoryRouter>
  );
}
`},Et=e=>_(e).some(t=>t.type==="file"&&/\.(jsx?|tsx?)$/i.test(t.path)&&dt.some(n=>n.test(t.content))),Ln=e=>{const t=_(e),n=t.find(s=>Zt.test(s.path));if(n)return n.path;const a=t.find(s=>k.test(s.path));return a?a.path:"src/App.jsx"},xt=e=>{const n=_(e).find(a=>k.test(a.path));return(n==null?void 0:n.path)||null},Un=(e,t,n)=>{const a=_(e),s=new Set(_(t).map(p=>p.path)),r=new Map,o=ie(a),i=o.size>0,c=(p,u,d,m,h=!1)=>{if(!s.has(d))return;const f=C(p||"/"),g=I(f),R={id:`${m}:${u}:${f}`,label:gt(g,u),routePath:f,codeFilePath:u,previewFilePath:d,kind:m,isDefault:h},w=r.get(g);w&&Y(w)>=Y(R)||r.set(g,R)},l=[...a].sort((p,u)=>p.path.localeCompare(u.path));if(l.forEach(p=>{const u=o.get(p.path)||[];if(u.length>0){u.forEach(f=>c(f,p.path,p.path,ne(p.path),f==="/"));return}const d=p.path.match(ut);if(d){const f=d[1]||"",g=F(f),R=g==="/"&&s.has(n)?n:p.path;c(g,p.path,R,"app",g==="/");return}const m=p.path.match(pt);if(m){if(i)return;const f=F(m[1]||"");c(f,p.path,p.path,"src-pages",f==="/");return}const h=p.path.match(Vt);if(h){const f=h[1]||"",g=W(f.split("/").pop()||"");if(Jt.has(g.toLowerCase()))return;const R=F(f);c(R,p.path,p.path,"pages",R==="/")}}),r.size===0){const p=l.find(u=>k.test(u.path));p&&c("/",p.path,p.path,"app",!0)}return[...r.values()].sort((p,u)=>{const d=I(p.routePath),m=I(u.routePath);return d==="/"?-1:m==="/"?1:d.localeCompare(m)})},zn=(e,t)=>e.find(n=>n.codeFilePath===t||n.previewFilePath===t)||null,kn=(e,t,n)=>{const a=new Set(_(e).map(i=>i.path)),s=a.has(n)&&Et(e),r=xt(e);if(t&&s&&r){const i=mt(r,e),c=r!==n&&!i;return{files:[...e.filter(p=>p.type!=="file"||p.path!==E),{name:E.split("/").pop()||"__aura_page_preview__.jsx",path:E,content:Rt(r,a,c),type:"file"}],mainFile:E,previewPath:t.routePath,hiddenCodeFiles:[E]}}return!t||t.previewFilePath===n||t.routePath==="/"&&t.codeFilePath===n?{files:e,mainFile:n,previewPath:(t==null?void 0:t.routePath)||"/",hiddenCodeFiles:[]}:a.has(t.previewFilePath)?{files:[...e.filter(i=>i.type!=="file"||i.path!==E),{name:E.split("/").pop()||"__aura_page_preview__.jsx",path:E,content:le(t,a),type:"file"}],mainFile:E,previewPath:t.routePath,hiddenCodeFiles:[E]}:{files:e,mainFile:n,previewPath:t.routePath,hiddenCodeFiles:[]}},Bn=(e,t,n)=>{const a=new Set(_(e).map(c=>c.path)),s=a.has(n)&&Et(e),r=xt(e);if(s&&r&&a.has(r)){const c=mt(r,e),l=r!==n&&!c;return{files:[...e.filter(u=>u.type!=="file"||u.path!==E),{name:E.split("/").pop()||"__aura_page_preview__.jsx",path:E,content:Rt(r,a,l),type:"file"}],mainFile:E,previewPath:"/",hiddenCodeFiles:[E]}}const o=t.length>0?t:r&&a.has(r)?[{id:`app:${r}:/`,label:gt("/",r),routePath:"/",codeFilePath:r,previewFilePath:r,kind:"app",isDefault:!0}]:[];return o.length===0?{files:e,mainFile:n,previewPath:"/",hiddenCodeFiles:[]}:{files:[...e.filter(c=>c.type!=="file"||c.path!==E),{name:E.split("/").pop()||"__aura_page_preview__.jsx",path:E,content:pe(o,a),type:"file"}],mainFile:E,previewPath:"/",hiddenCodeFiles:[E]}},ue=["index.html","public/index.html"],de=`export default function App() {
  return <div>React project preview</div>;
}
`,Pt=e=>{const t=[];return e.forEach(n=>{if(n.type==="file"){t.push({path:n.path,content:n.content});return}t.push(...Pt(n.children))}),t},Wn=e=>{const t=Pt(e);return Object.fromEntries(ue.flatMap(n=>{const a=t.find(s=>s.path===n);return a?[[n,a.content]]:[]}))},Xn=e=>{var c,l,p;const t=e.find(u=>u.type==="file"&&u.path==="index.html"),n=e.filter(u=>u.path!=="index.html"&&u.path!=="vite.config.js"&&u.path!=="vite.config.ts"&&u.path!=="postcss.config.js").map(u=>u.type==="folder"?{...u,children:[...u.children]}:{...u}),a=u=>n.find(d=>d.type==="file"&&d.path===u);if(!a("public/index.html")){let u=`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>React Project</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;t&&t.type==="file"&&(u=t.content.replace(/<script[^>]*type=["']module["'][^>]*src=["'][^"']*["'][^>]*>\s*<\/script>/gi,"").replace(/<script[^>]*src=["'][^"']*main\.(jsx|tsx|js)["'][^>]*>\s*<\/script>/gi,"")),n.push({name:"index.html",path:"public/index.html",content:u,type:"file"})}const r=a("src/index.js"),o=a("src/main.jsx")||a("src/main.tsx")||a("src/index.tsx"),i=((c=a("src/App.jsx"))==null?void 0:c.path)||((l=a("src/App.tsx"))==null?void 0:l.path)||((p=a("src/App.js"))==null?void 0:p.path)||"src/App.jsx";if(a(i)||n.push({name:"App.jsx",path:"src/App.jsx",content:de,type:"file"}),!r){let u=`import React from 'react';
	import { createRoot } from 'react-dom/client';
	import App from './${i.replace("src/","")}';
	import './index.css';

	createRoot(document.getElementById('root')).render(
	  <React.StrictMode>
	    <App />
	  </React.StrictMode>
);`;o&&o.type==="file"&&(u=o.content.replace(/\bas HTMLElement\b/g,"").replace(/\bas HTMLDivElement\b/g,"")),n.push({name:"index.js",path:"src/index.js",content:u,type:"file"})}return n},he=/\.(jsx?|tsx?)$/i,Q=/(?:import\s+[^"'`]*?\s+from\s+|export\s+[^"'`]*?\s+from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g,me=/(?:^|[\r\n])\s*"\s*,\s*(?:\r?\n)+\s*["']?(?:action|path|content|explanation)\b[\s\S]*$/i,fe=/(?:^|[\r\n])\s*"\s*(?:,\s*)?(?:\r?\n\s*)*[}\]]+\s*$/i,ge=/\.\.\.\s*\[\s*rest\s+of\s+the\s+file\s+remains\s+unchanged\s*\]/i,Re="src/lib/auraCms.js",Ee=/SUPABASE_ANON_KEY|AUTH_STORAGE_KEY|createClient\s*\(|@supabase\/supabase-js|rest\/v1\/(?:cms_collections|cms_items|rpc\/get_public_cms_items_by_project_and_collection)|https?:\/\/[a-z0-9-]+(?:-all)?\.supabase\.co/i,xe=5e4,_t=1e5,Pe=/\bon[A-Z][A-Za-z0-9_$]*\s*=\s*{\s*([A-Za-z_$][\w$]*)\s*}/g,_e=/\b(?:function|class)\s+([A-Za-z_$][\w$]*)\b|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b/g,$e=/\b(?:const|let|var)\s*{([^}]+)}\s*=/g,Te=/\b(?:const|let|var)\s*\[([^\]]+)]\s*=/g,Ae=/\bimport\s+([\s\S]*?)\s+from\s+["'][^"']+["'];?/g,Se=/\bfunction\b[^{=;()\n]*\(([^)]*)\)/g,be=/(?:^|[=(:,]\s*)\(?([^()=;{}]*)\)?\s*=>/g,we=/\b[A-Za-z_$][\w$]*\b/g,Ie=new Set(["Array","Boolean","Date","Error","JSON","Math","Number","Object","Promise","String","alert","clearInterval","clearTimeout","confirm","console","document","false","globalThis","localStorage","null","sessionStorage","setInterval","setTimeout","true","undefined","window"]),Ce=new Set(["as","async","await","boolean","const","default","export","extends","false","from","function","import","let","null","number","return","string","true","type","undefined","var","void"]),ve=/\bexport\s+default\b|export\s*\{\s*[A-Za-z_$][\w$]*\s+as\s+default\s*\}/,X=/^src\/pages\/.+\.(jsx?|tsx?)$|^src\/App\.(jsx?|tsx?)$/i,ye=/\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?/,Fe=/\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)\s*\(/,Ne=["",".js",".jsx",".ts",".tsx",".css",".json"],Oe=["/index.js","/index.jsx","/index.ts","/index.tsx","/index.css"],A=e=>he.test(e),S=e=>e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),$=(e,t)=>{const n=String(t||"").trim();n&&/^[A-Za-z_$][\w$]*$/.test(n)&&!Ce.has(n)&&e.add(n)},N=(e,t)=>{for(const n of String(t||"").matchAll(we))$(e,n[0])},Me=(e,t)=>{String(t||"").split(",").map(n=>n.trim()).filter(Boolean).forEach(n=>{const a=n.replace(/=.*$/,"").replace(/\?.*$/,"").trim(),s=a.match(/:\s*([A-Za-z_$][\w$]*)$/);$(e,(s==null?void 0:s[1])||a)})},je=(e,t)=>{var o;const n=String(t||"").trim();if(!n)return;const a=n.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);a&&$(e,a[1]);const s=n.match(/{([^}]+)}/);s&&s[1].split(",").map(i=>i.trim().replace(/^type\s+/,"")).filter(Boolean).forEach(i=>{const c=i.split(/\s+as\s+/);$(e,c[1]||c[0])});const r=(o=n.replace(/\*\s+as\s+[A-Za-z_$][\w$]*/,"").replace(/{[^}]+}/,"").split(",")[0])==null?void 0:o.trim().replace(/^type\s+/,"");$(e,r)},De=e=>{const t=new Set(Ie);for(const n of e.matchAll(Ae))je(t,n[1]);for(const n of e.matchAll(_e))$(t,n[1]||n[2]);for(const n of e.matchAll($e))Me(t,n[1]);for(const n of e.matchAll(Te))N(t,n[1]);for(const n of e.matchAll(Se))N(t,n[1]);for(const n of e.matchAll(be))N(t,n[1]);return t},$t=(e,t)=>{var i;if(!A(e)||t.length>_t)return[];const n=De(t),a=[];let s=0,r=1,o=0;for(const c of t.matchAll(Pe)){const l=c[1];if(n.has(l))continue;const p=c.index||0;for(;s<p;s+=1)t.charCodeAt(s)===10&&(r+=1,o=s+1);const u=p-o+1,d=((i=c[0].split("=")[0])==null?void 0:i.trim())||"event handler";a.push({attribute:d,column:u,identifier:l,line:r,path:e,reason:`${e}:${r}:${u} references ${l} in JSX ${d}, but no local declaration, import, or parameter was found.`})}return a},G=e=>{const t=[];return e.forEach(n=>{if(n.type==="file"){t.push({path:n.path,content:typeof n.content=="string"?n.content:""});return}t.push(...G(n.children))}),t},D=e=>e.replace(/[?#].*$/,"").replace(/\\/g,"/").trim(),Tt=e=>{const t=D(e);return t.startsWith(".")||t.startsWith("@/")||t.startsWith("~/")||t.startsWith("/")||t.startsWith("src/")},At=(e,t)=>{const n=D(t);if(!Tt(n))return[];const a=e.split("/").slice(0,-1),s=new Set,r=o=>{const i=D(o).replace(/^\/+/,"");i&&s.add(i)};if(n.startsWith(".")){const o=n.split("/"),i=[...a];o.forEach(c=>{if(!(!c||c===".")){if(c===".."){i.pop();return}i.push(c)}}),r(i.join("/"))}else if(n.startsWith("@/")||n.startsWith("~/")){const o=n.slice(2);r(o),r(`src/${o}`)}else if(n.startsWith("/")){const o=n.slice(1);r(o),r(`src/${o}`)}else n.startsWith("src/")&&r(n);return[...s].flatMap(o=>o.match(/\.[^.]+$/)?[o]:[...Ne.map(i=>`${o}${i}`),...Oe.map(i=>`${o}${i}`)])},Le=(e,t,n)=>At(e,t).find(s=>n.has(s))||null,St=(e,t,n)=>{var r;if(!A(e)||t.length>_t)return[];const a=[];let s=null;for(;s=Q.exec(t);){const o=(r=s[1])==null?void 0:r.trim();if(!o||!Tt(o))continue;const i=At(e,o);Le(e,o,n)||a.push({candidatePaths:i,importPath:o,path:e,reason:`Local import "${o}" does not resolve to a project file.`})}return Q.lastIndex=0,a},Ue=(e,t)=>{if(!X.test(e))return null;const n=t.match(ye),a=n==null?void 0:n[1];return a&&[new RegExp(`\\b(?:const|let|var)\\s+${S(a)}\\s*=\\s*\\[`,"m"),new RegExp(`\\b(?:const|let|var)\\s+${S(a)}\\s*=\\s*\\{`,"m"),new RegExp(`\\b(?:const|let|var)\\s+${S(a)}\\s*=\\s*new\\s+(?:Map|Set)\\b`,"m")].some(r=>r.test(t))?`Default export "${a}" resolves to a collection value instead of a React component.`:null},ze=(e,t)=>{if(!X.test(e))return null;const n=t.match(Fe),a=n==null?void 0:n[1];if(!a)return null;const s=new RegExp(`\\b(?:function|class)\\s+${S(a)}\\b|\\b(?:const|let|var)\\s+${S(a)}\\b`,"g"),r=[...t.matchAll(s)].length;return r>1?`Default export component "${a}" is declared ${r} times in this module.`:null},ke=(e,t,n)=>{if(!A(e))return null;if(me.test(t)||fe.test(t))return"Trailing JSON residue was detected in the file content.";if(ge.test(t))return"Placeholder text indicating truncated file output was detected in the file content.";if(e===Re&&Ee.test(t))return"Direct Supabase CMS credentials or transport logic were detected in the Aura CMS runtime.";if((X.test(e)||typeof n=="string")&&!ve.test(t))return"Missing default export for a route or existing default-exported module.";const s=$t(e,t)[0];if(s)return s.reason;const r=Ue(e,t);if(r)return r;const o=ze(e,t);return o||null},bt=(e,t)=>{const n=e.toLowerCase();return n.endsWith(".tsx")?t.ScriptKind.TSX:n.endsWith(".jsx")?t.ScriptKind.JSX:n.endsWith(".ts")?t.ScriptKind.TS:t.ScriptKind.JS},q=(e,t,n)=>{const a=n.flattenDiagnosticMessageText(e.messageText,`
`).trim();if(!a)return"A syntax error was detected in the generated source.";const s=typeof e.start=="number"&&e.start>=0?e.start:null,r=s!==null?` near character ${s+1}`:"";let o="";if(s!==null&&s<t.length){const i=t.codePointAt(s),c=t.slice(s,s+(i&&i>65535?2:1)),l=JSON.stringify(c).slice(1,-1).replace(/"/g,'\\"');if(i!==void 0){const m=i.toString(16).toUpperCase().padStart(4,"0");o=` Found ${l||"an unprintable character"} (U+${m}).`}const p=Math.max(0,s-40),u=Math.min(t.length,s+Math.max(typeof e.length=="number"?e.length:1,1)+40),d=t.slice(p,u).replace(/\r/g,"\\r").replace(/\n/g,"\\n").replace(/\t/g,"\\t");d&&(o+=` Context: "${d}".`)}return`${a}${r}.${o}`},Be=(e,t)=>{const n=e.expression;if(t.isIdentifier(n)&&/^use[A-Z0-9]/.test(n.text))return n.text;if(t.isPropertyAccessExpression(n)&&t.isIdentifier(n.name)&&/^use[A-Z0-9]/.test(n.name.text)){const a=n.expression;if(t.isIdentifier(a)&&(a.text==="React"||/^React[A-Z0-9]/.test(a.text)))return n.name.text}return null},wt=(e,t)=>t.isFunctionDeclaration(e)||t.isFunctionExpression(e)||t.isArrowFunction(e)||t.isMethodDeclaration(e),tt=(e,t)=>{if((t.isFunctionDeclaration(e)||t.isFunctionExpression(e))&&e.name)return e.name.text;const n=e.parent;return n&&t.isVariableDeclaration(n)&&t.isIdentifier(n.name)||n&&t.isPropertyAssignment(n)&&t.isIdentifier(n.name)?n.name.text:n&&t.isExportAssignment(n)?"default":""},We=e=>e==="default"||/^[A-Z]/.test(e)||/^use[A-Z0-9]/.test(e),Xe=(e,t)=>{let n=e.parent;for(;n;){if(wt(n,t))return n;n=n.parent}return null},Ge=(e,t)=>t.isIfStatement(e)||t.isConditionalExpression(e)||t.isForStatement(e)||t.isForInStatement(e)||t.isForOfStatement(e)||t.isWhileStatement(e)||t.isDoStatement(e)||t.isSwitchStatement(e)||t.isCaseClause(e)||t.isDefaultClause(e)||t.isBinaryExpression(e)&&(e.operatorToken.kind===t.SyntaxKind.AmpersandAmpersandToken||e.operatorToken.kind===t.SyntaxKind.BarBarToken||e.operatorToken.kind===t.SyntaxKind.QuestionQuestionToken),He=(e,t,n)=>{if(!A(e))return null;const a=bt(e,n),s=n.createSourceFile(e,t,n.ScriptTarget.Latest,!0,a);let r=null;const o=i=>{if(!r){if(n.isCallExpression(i)){const c=Be(i,n);if(c){const l=Xe(i,n),p=l?tt(l,n):"",{line:u,character:d}=s.getLineAndCharacterOfPosition(i.getStart(s)),m=`line ${u+1}, column ${d+1}`;if(!l||!We(p)){r=`React Hook "${c}" is called outside a React component or custom Hook (${m}). Move it into a component whose name starts with an uppercase letter or into a custom Hook whose name starts with "use".`;return}let h=i.parent;for(;h&&h!==l;){if(wt(h,n)){const f=tt(h,n);r=`React Hook "${c}" is called inside nested function "${f||"anonymous"}" (${m}). Hooks must run at the top level of a React component or custom Hook.`;return}if(Ge(h,n)){r=`React Hook "${c}" is called conditionally in "${p}" (${m}). Move it before conditional branches, loops, and short-circuit expressions.`;return}h=h.parent}}}n.forEachChild(i,o)}};return o(s),r},Ze=async(e,t,n)=>{var c;if(!A(e))return null;const a=bt(e,n),r=n.createSourceFile(e,t,n.ScriptTarget.Latest,!1,a).parseDiagnostics.find(l=>l.category===n.DiagnosticCategory.Error);if(r)return q(r,t,n);if(t.length>xe)return null;const i=(c=n.transpileModule(t,{fileName:e,compilerOptions:{allowJs:!0,jsx:n.JsxEmit.ReactJSX,module:n.ModuleKind.ESNext,target:n.ScriptTarget.ES2020},reportDiagnostics:!0}).diagnostics)==null?void 0:c.find(l=>l.category===n.DiagnosticCategory.Error);return i?q(i,t,n):null},Ve=async e=>{var r;const t=await Ht(()=>import("./typescript-CmGuhDT8.js").then(o=>o.t),__vite__mapDeps([0,1,2,3])),n=G(e),a=new Set(n.map(o=>o.path)),s=[];for(const o of n){if(!A(o.path))continue;const i=o.content||"",c=ke(o.path,i)||await Ze(o.path,i,t)||He(o.path,i,t)||((r=St(o.path,i,a)[0])==null?void 0:r.reason)||null;c&&s.push({path:o.path,reason:c})}return s},Gn=async e=>{const t=(await Ve(e))[0];if(t)throw new Error(`Rejected invalid React project source in ${t.path}: ${t.reason}`)},Je=(e,t)=>{const n=G(e),a=new Set([...n.map(s=>s.path),...Array.from((t==null?void 0:t.existingFilePaths)||[])]);return n.flatMap(s=>St(s.path,s.content||"",a))},P=/\.(jsx?|tsx?)$/i,Ke=new Set(["App","Button","Card","Dialog","Drawer","Form","Image","Input","Label","Layout","Link","Menu","Modal","Option","Select","Sheet","Tab","Tabs","Textarea"]),O=/import\s*{\s*([^}]+)\s*}\s*from\s*(["'])lucide-react\2;?/m,Ye=/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/g,et=/((?:import\s+[^"'`]*?\s+from\s+|export\s+[^"'`]*?\s+from\s+|import\s+|import\s*\(\s*|require\s*\(\s*))(["'])([^"']+)\2/g,Qe=/(?:export\s+default\s+)?function\s+([A-Z][A-Za-z0-9_]*)\s*\(/g,qe=/(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=/g,tn=/class\s+([A-Z][A-Za-z0-9_]*)\s+/g,en=/<([A-Z][A-Za-z0-9_]*)\b([^>]*)\/?>/g,nn=/\b(dataKey|stroke|fill|stackId|dot|activeDot|type|connectNulls|xAxisId|yAxisId|name|unit|baseValue|points|layout)\s*=/,sn="\\bexport\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+%s\\b",nt=/\b(?:React\.)?Children\.only\(\s*(children|props\.children)\s*\)/g,v="__auraEnsureRenderableChild",rn=/\b(path|to|href)\s*=\s*(["'])([^"']+)\2/g,an=/\b(path|to|href)\s*:\s*(["'])([^"']+)\2/g,on=/\b(navigate|redirect|replace|push)\s*\(\s*(["'])([^"']+)\2/g,cn=/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s+(["'])react-dom\/client\2;?/g,ln=/(?:^|\/)src\/(?:main|index)\.(?:jsx?|tsx?)$/i,It=/((?:export\s+default\s+)?function\s+[A-Z][A-Za-z0-9_$]*\s*\([^)]*\)\s*{)/,Ct=/((?:export\s+default\s+)?const\s+[A-Z][A-Za-z0-9_$]*\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*{)/,st=/\bexport\s+default\s+function\s+([A-Z][A-Za-z0-9_$]*)\s*\(/,pn=/\bvalue\s*=\s*{\s*([a-z][A-Za-z0-9_$]*)\s*}/g,un=/\btoast\b/,dn=`/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
`,hn=`export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;function b(e){return e.split(",").map(t=>t.trim()).filter(Boolean)}function L(e){const t=e.split(/\s+as\s+/);return(t[1]||t[0]||"").trim()}function vt(e){return[...e.matchAll(Ye)].map(t=>({clause:t[1].trim(),modulePath:t[2].trim()}))}function y(e){const t=[];for(const n of e)t.push(n),n.type==="folder"&&t.push(...y(n.children));return t}function x(e){return e.replace(/^\/+/,"").replace(/\\/g,"/")}function mn(e){return e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}function U(e,t){return y(e).some(n=>n.type==="file"&&t.test(x(n.path)))}function fn(e){return y(e).some(t=>t.type==="file"&&/\.(css|scss|sass)$/i.test(t.path)&&/@tailwind\s+(base|components|utilities)\s*;/.test(t.content))}function yt(e){let t=!1;const n=[];return{files:e.map(s=>{if(s.type==="folder"){const u=yt(s.children);return u.changed?(t=!0,n.push(...u.repairs),{...s,children:u.files}):s}if(!ln.test(x(s.path)))return s;let r=s.content;const o=[],i=/<\/React\.StrictMode\s*>/.test(r);if(/<React\.StrictMode\b[^>]*>/.test(r)&&!i){const u=r.match(/<App\b[^>]*\/>/);if(u){const d=(u.index||0)+u[0].length;r=`${r.slice(0,d)}
  </React.StrictMode>${r.slice(d)}`,o.push("closed an unbalanced <React.StrictMode> wrapper")}}const l=/<\/StrictMode\s*>/.test(r);if(/<StrictMode\b[^>]*>/.test(r)&&!l){const u=r.match(/<App\b[^>]*\/>/);if(u){const d=(u.index||0)+u[0].length;r=`${r.slice(0,d)}
  </StrictMode>${r.slice(d)}`,o.push("closed an unbalanced <StrictMode> wrapper")}}return o.length===0?s:(t=!0,n.push(`${s.path}: ${o.join("; ")}`),{...s,content:r})}),changed:t,repairs:n}}function gn(e){return U(e,/(?:^|\/)vite\.config\.(?:[cm]?[jt]s)$/i)}function Rn(e){if(!gn(e)||!fn(e))return{files:e,changed:!1,repairs:[]};const t=[...e],n=[];return U(t,/(?:^|\/)tailwind\.config\.(?:[cm]?[jt]s)$/i)||(t.push({name:"tailwind.config.js",type:"file",path:"tailwind.config.js",content:dn}),n.push("Added missing Tailwind config for Vite CSS compilation.")),U(t,/(?:^|\/)postcss\.config\.(?:[cm]?[jt]s)$/i)||(t.push({name:"postcss.config.js",type:"file",path:"postcss.config.js",content:hn}),n.push("Added missing PostCSS config for Tailwind compilation.")),{files:t,changed:n.length>0,repairs:n}}function En(e){const t=[...e.matchAll(cn)].map(s=>({localName:s[1],statement:s[0]}));if(t.length===0)return{changed:!1,content:e};let n=!1,a=e;return t.forEach(({localName:s,statement:r})=>{const o=new RegExp(`\\b${mn(s)}\\.createRoot\\s*\\(`,"g");if(o.test(a)){if(n=!0,o.lastIndex=0,a=a.replace(o,"createRoot("),/\bimport\s*{[^}]*\bcreateRoot\b[^}]*}\s*from\s*(["'])react-dom\/client\1;?/.test(a)){a=a.replace(r,"").replace(/\n{3,}/g,`

`);return}a=a.replace(r,'import { createRoot } from "react-dom/client";')}}),{changed:n,content:a}}function Ft(e){let t=!1;const n=[];return{files:e.map(s=>{if(s.type==="folder"){const o=Ft(s.children);return o.changed?(t=!0,n.push(...o.repairs),{...s,children:o.files}):s}if(!P.test(s.path))return s;const r=En(s.content);return r.changed?(t=!0,n.push(`${s.path}: replaced react-dom/client default createRoot usage with named createRoot import.`),{...s,content:r.content}):s}),changed:t,repairs:n}}function rt(e){return x(e).replace(/\.(jsx?|tsx?|css|scss|sass|less|json)$/i,"")}function at(e){return e.replace(/\/index$/i,"")}function Nt(e){const t=x(e);return(t.split("/").pop()||t).replace(/\.[^.]+$/,"")}function ot(e){return e.toLowerCase().replace(/(?:section|component|view|page|layout)$/g,"").replace(/s$/g,"")}function xn(e){const t=e.replace(/[?#].*$/,"").trim();return t.startsWith(".")||t.startsWith("@/")||t.startsWith("~/")||t.startsWith("/")||t.startsWith("src/")}function z(e){return/\.(jsx?|tsx?)$/i.test(e)}function Pn(e,t,n){const a=x(e).split("/").slice(0,-1),r=[...x(t).split("/")],o=[...a];for(;o.length>0&&r.length>0&&o[0]===r[0];)o.shift(),r.shift();let i=[...new Array(o.length).fill(".."),...r].join("/");return i?i.startsWith(".")||(i=`./${i}`):i="./",!/\.[a-z0-9]+$/i.test(n.replace(/[?#].*$/,"").trim())&&z(t)&&(i=i.replace(/\.(jsx?|tsx?)$/i,""),i=i.replace(/\/index$/i,"")),i}function Ot(e){const n=Nt(e).replace(/[^A-Za-z0-9]+/g," ").trim().split(/\s+/).filter(Boolean).map(a=>a.charAt(0).toUpperCase()+a.slice(1)).join("");return n&&/^[A-Z]/.test(n)?n:"RecoveredComponent"}function _n(e){const t=Nt(e).replace(/[^A-Za-z0-9_$]/g,"");return t&&/^use[A-Z0-9_]/.test(t)?t:`use${Ot(e)}`}function H(e){return/^(?:src\/(?:App|main|index)\.(jsx?|tsx?)|app\/layout\.(jsx?|tsx?)|pages\/_app\.(jsx?|tsx?))$/i.test(x(e))}function Mt(e){return/(?:^|\/)use[A-Z0-9][A-Za-z0-9_$-]*\.(jsx?|tsx?)$/i.test(x(e))}function it(e){const t=x(e);return H(t)||Mt(t)||/^(?:src\/pages\/.+|pages\/(?!_).+|app(?:\/.+)?\/page)\.(jsx?|tsx?)$/i.test(t)||/(?:^|\/)(?:App|[^/]*Layout|Navbar|NavBar|Navigation|Header|Footer|Menu|Topbar|Sidebar|Shell)\.(jsx?|tsx?|css)$/i.test(t)}function $n(e){const t=Ot(e),n=x(e);if(Mt(e)){const a=_n(e);return`import React from "react";

// Auto-generated by Aura to keep the project runnable after a missing local hook import.
export function ${a}() {
  return React.useMemo(() => ({ current: null }), []);
}

export default ${a};
`}return H(e)?`import React from "react";

// Auto-generated by Aura after a required app shell file went missing during repair.
export function ${t}() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px",
        background: "#f5f5f0",
        color: "#1f2a1f",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "560px",
          border: "1px solid rgba(31, 42, 31, 0.16)",
          background: "rgba(255, 255, 255, 0.92)",
          padding: "24px",
          boxShadow: "0 16px 50px rgba(15, 23, 15, 0.08)",
        }}
      >
        <div style={{ fontSize: "12px", letterSpacing: "0.18em", textTransform: "uppercase", opacity: 0.55 }}>
          Aura Recovery
        </div>
        <h1 style={{ margin: "16px 0 8px", fontSize: "28px", lineHeight: 1.1 }}>
          The app shell was replaced during auto-repair.
        </h1>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, opacity: 0.78 }}>
          ${n} was missing, so Aura inserted a temporary recovery
          component instead of leaving the preview blank.
        </p>
      </div>
    </div>
  );
}

export default ${t};
`:`import React from "react";

// Auto-generated by Aura to keep the project runnable after a missing local component import.
export function ${t}() {
  return null;
}

export default ${t};
`}function Tn(e,t){const n=new Map;t.forEach(c=>{const l=x(c).toLowerCase(),p=n.get(l)||[];p.push(c),n.set(l,p)});for(const c of e){const l=n.get(x(c).toLowerCase())||[];if(l.length===1)return l[0]}const a=e.find(c=>z(c))||e[0]||"",r=at(rt(a)).split("/").filter(Boolean).map(c=>c.toLowerCase()),o=ot(r[r.length-1]||"");if(!o)return null;const i=[...t].filter(c=>z(c)).map(c=>{const p=at(rt(c)).split("/").filter(Boolean).map(g=>g.toLowerCase());if(ot(p[p.length-1]||"")!==o)return null;let d=10;const m=Math.min(r.length,p.length);for(let g=1;g<=m&&r[r.length-g]===p[p.length-g];g+=1)d+=g===1?4:2;const h=r[r.length-2],f=p[p.length-2];return h&&f&&h===f&&(d+=3),{path:c,score:d}}).filter(c=>!!c).sort((c,l)=>l.score-c.score);return i.length===0?null:i.length===1||i[0].score>i[1].score?i[0].path:null}function An(e,t){const n=e.replace(et,(a,s,r,o)=>{const i=t.get(o.trim());return!i||i===o.trim()?a:`${s}${r}${i}${r}`});return et.lastIndex=0,n}function Sn(e,t){var c;const n=Je(e,{existingFilePaths:Object.keys({})});if(n.length===0)return{files:e,changed:!1,repairs:[]};const a=new Map(e.map(l=>[l.path,l.type==="folder"?{...l,children:[...l.children]}:{...l}])),s=new Set(e.filter(l=>l.type==="file").map(l=>l.path)),r=[];let o=!1;const i=new Map;for(const l of n){if(!xn(l.importPath))continue;let u=l.candidatePaths.find(h=>s.has(h))||Tn(l.candidatePaths,s);if(!u){const h=l.candidatePaths.find(R=>/\.(jsx|tsx)$/i.test(R))||l.candidatePaths.find(R=>/\.(js|ts)$/i.test(R))||null;if(!h)continue;const f=x(h),g=(c=t==null?void 0:t.fallbackFilesByPath)==null?void 0:c[f];if(it(f)&&typeof g=="string"){if(!s.has(f)){const R={name:f.split("/").pop()||f,path:f,content:g,type:"file"};a.set(f,R),s.add(f),r.push(`${f}: restored the previous source file instead of generating a placeholder because ${l.path} imported a missing protected module.`),o=!0}u=f}if(!u&&it(f)&&!H(f)){r.push(`${f}: skipped placeholder creation because ${l.path} imported a missing protected module.`);continue}if(!s.has(h)){const R={name:h.split("/").pop()||h,path:h,content:$n(h),type:"file"};a.set(h,R),s.add(h),r.push(`${h}: created a fallback component because ${l.path} imported a missing local module.`),o=!0}u=h}if(!u)continue;const d=Pn(l.path,u,l.importPath);if(d===l.importPath)continue;const m=i.get(l.path)||new Map;i.has(l.path)||i.set(l.path,m),m.set(l.importPath,d),r.push(`${l.path}: rewrote missing local import "${l.importPath}" to "${d}".`),o=!0}return i.forEach((l,p)=>{const u=a.get(p);!u||u.type!=="file"||a.set(p,{...u,content:An(u.content,l)})}),{files:Array.from(a.values()),changed:o,repairs:r}}function bn(e,t=new Set){const n=new Set;for(const{clause:a,modulePath:s}of vt(e))if(!t.has(s)){if(a.startsWith("{")){const r=a.match(/^\{\s*([^}]+)\s*\}$/);if(r)for(const o of b(r[1]))n.add(L(o));continue}if(a.startsWith("* as ")){n.add(a.replace("* as ","").trim());continue}if(a.includes("{")){const[r,o]=a.split(",",2);r!=null&&r.trim()&&n.add(r.trim());const i=o==null?void 0:o.match(/\{\s*([^}]+)\s*\}/);if(i)for(const c of b(i[1]))n.add(L(c));continue}n.add(a)}return n}function wn(e){var a;const t=new Set,n=e.match(/\{\s*([^}]+)\s*\}/);if(!n)return t;for(const s of b(n[1])){const r=s.replace(/^type\s+/,"").trim();if(!r)continue;const o=(a=r.split(/\s+as\s+/)[0])==null?void 0:a.trim();o&&t.add(o)}return t}function In(e,t,n){const a=t.replace(/[?#].*$/,"").trim();if(!a)return null;const s=x(e).split("/").slice(0,-1),r=new Set,o=c=>{const l=x(c);l&&r.add(l)},i=c=>{const l=x(c);l&&(o(l),l.startsWith("src/")||o(`src/${l}`))};if(a.startsWith(".")){const c=[...s];for(const l of a.split("/"))if(!(!l||l===".")){if(l===".."){c.pop();continue}c.push(l)}o(c.join("/"))}else if(a.startsWith("@/")||a.startsWith("~/"))i(a.slice(2));else if(a.startsWith("/"))i(a.slice(1));else if(a.startsWith("src/")||a.includes("/"))i(a);else return null;for(const c of r){const p=(c.match(/\.(jsx?|tsx?)$/i)?[c]:[`${c}.js`,`${c}.jsx`,`${c}.ts`,`${c}.tsx`,`${c}/index.js`,`${c}/index.jsx`,`${c}/index.ts`,`${c}/index.tsx`]).find(u=>n.has(u));if(p)return p}return null}function ct(e,t){if(new RegExp(sn.replace(/%s/g,t)).test(e))return!0;for(const a of e.matchAll(/\bexport\s+(type\s+)?\{([^}]+)\}/g)){if(!!a[1])continue;const r=b(a[2]||"");for(const o of r){const i=o.replace(/^type\s+/,"").trim();if(!i)continue;const c=i.split(/\s+as\s+/);if((c[1]||c[0]||"").trim()===t)return!0}}return!1}function jt(e,t,n){const{includeToast:a,includeUseToast:s}=n,r=/\.tsx?$/i.test(t),o=[];return e.includes("__auraToastCompatApi")||(r?o.push("const __auraToastCompatDispatch = (..._args: unknown[]) => undefined;","const __auraToastCompatApi = Object.assign(__auraToastCompatDispatch, {","  toast: __auraToastCompatDispatch,","  success: __auraToastCompatDispatch,","  error: __auraToastCompatDispatch,","  info: __auraToastCompatDispatch,","  warning: __auraToastCompatDispatch,","  dismiss: () => undefined,","});"):o.push("const __auraToastCompatDispatch = (..._args) => undefined;","const __auraToastCompatApi = Object.assign(__auraToastCompatDispatch, {","  toast: __auraToastCompatDispatch,","  success: __auraToastCompatDispatch,","  error: __auraToastCompatDispatch,","  info: __auraToastCompatDispatch,","  warning: __auraToastCompatDispatch,","  dismiss: () => undefined,","});")),a&&o.push("export const toast = __auraToastCompatApi;"),s&&o.push("export const useToast = () => __auraToastCompatApi;"),o.join(`
`)}function Cn(e){return/\.tsx?$/i.test(e)?`
function ${v}(candidate: any) {
  const renderedChildren = (Array.isArray(candidate) ? candidate : [candidate]).filter(
    (child: any) => child !== undefined && child !== null && child !== false
  );

  if (renderedChildren.length === 1 && React.isValidElement(renderedChildren[0])) {
    return renderedChildren[0];
  }

  return <div style={{ display: "contents" }}>{renderedChildren}</div>;
}
`:`
function ${v}(candidate) {
  const renderedChildren = (Array.isArray(candidate) ? candidate : [candidate]).filter(
    (child) => child !== undefined && child !== null && child !== false
  );

  if (renderedChildren.length === 1 && React.isValidElement(renderedChildren[0])) {
    return renderedChildren[0];
  }

  return <div style={{ display: "contents" }}>{renderedChildren}</div>;
}
`}function vn(e,t){let n=`${e}Icon`,a=2;for(;t.has(n);)n=`${e}Icon${a}`,a+=1;return n}function yn(e){const t=e.trim();if(!t||/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(t)||/^(?:\.{1,2}\/|src\/|public\/|pages\/|app\/)/i.test(t)||t.includes("{")||t.includes("}"))return null;const[n,a=""]=t.split(/(?=[?#])/,2),s=n.startsWith("/"),o=n.replace(/\\/g,"/").replace(/\/+/g,"/").replace(/^\/+/,"").split("/");if(o.length===0)return null;const i=o.length-1,c=o[i]||"";let l=!1;if(/^index\.html?$/i.test(c))return null;/\.html?$/i.test(c)&&(o[i]=c.replace(/\.html?$/i,""),l=!0);const p=o.filter(Boolean),u=p.length>0?`${s?"/":""}${p.join("/")}`:"/";return!l||u===t?null:`${u}${a}`}function M(e,t){let n=0;const a=e.replace(t,(s,r,o,i)=>{const c=yn(i);return!c||c===i?s:(n+=1,s.replace(`${o}${i}${o}`,`${o}${c}${o}`))});return t.lastIndex=0,{content:a,changes:n}}function lt(e,t){let n=e;for(const[a,s]of t.entries()){const r=new RegExp(`<${a}\\b([^>]*)\\/?>`,"g");n=n.replace(r,(o,i)=>nn.test(i||"")?o:o.replace(`<${a}`,`<${s}`))}return n}function Fn(e){const t=new Set;for(const n of[Qe,qe,tn])for(const a of e.matchAll(n))a[1]&&t.add(a[1]);return t}function Dt(e,t=new Set){for(const n of e){if(n.type==="folder"){Dt(n.children,t);continue}const s=(n.path.split("/").pop()||"").replace(/\.[^.]+$/,"");/^[A-Z][A-Za-z0-9_]*$/.test(s)&&t.add(s)}return t}function Nn(e,t){const n=e.match(O);if(!n)return{content:e,changed:!1,repairedIcons:[],aliasedIcons:[]};const a=bn(e,new Set(["lucide-react"])),s=Fn(e),r=new Set([...a,...s]),o=b(n[1]),i=new Set,c=[],l=new Map,p=[];for(const m of o){const f=(m.split(/\s+as\s+/)[0]||"").trim(),g=L(m);let R=g;(r.has(g)||i.has(g))&&(R=vn(f,new Set([...r,...i])),l.set(g,R),c.push(`${f} as ${R}`)),i.add(R),r.add(R),p.push(f===R?f:`${f} as ${R}`)}const u=new Set;for(const m of e.matchAll(en)){const h=m[1],f=m[2]||"";r.has(h)||i.has(h)||t.has(h)||Ke.has(h)||/\b(size|strokeWidth)\s*=/.test(f)&&u.add(h)}if(u.size===0){if(l.size===0)return{content:e,changed:!1,repairedIcons:[],aliasedIcons:[]};const m=`import { ${p.join(", ")} } from ${n[2]}lucide-react${n[2]};`;return{content:lt(e.replace(O,m),l),changed:!0,repairedIcons:[],aliasedIcons:c}}for(const m of u)i.has(m)||p.push(m);const d=`import { ${p.join(", ")} } from ${n[2]}lucide-react${n[2]};`;return{content:lt(e.replace(O,d),l),changed:l.size>0||u.size>0,repairedIcons:[...u],aliasedIcons:c}}function Lt(e,t){let n=!1;const a=[];return{files:e.map(r=>{if(r.type==="folder"){const i=Lt(r.children,t);return i.changed?(n=!0,a.push(...i.repairs),{...r,children:i.files}):r}if(!P.test(r.path))return r;const o=Nn(r.content,t);return o.changed?(n=!0,o.repairedIcons.length>0&&a.push(`${r.path}: added missing lucide-react imports (${o.repairedIcons.join(", ")})`),o.aliasedIcons.length>0&&a.push(`${r.path}: aliased conflicting lucide-react imports (${o.aliasedIcons.join(", ")})`),{...r,content:o.content}):r}),changed:n,repairs:a}}function Ut(e){let t=!1;const n=[];return{files:e.map(s=>{if(s.type==="folder"){const i=Ut(s.children);return i.changed?(t=!0,n.push(...i.repairs),{...s,children:i.files}):s}if(!P.test(s.path))return s;const r=s.content.replace(nt,`${v}($1)`);if(nt.lastIndex=0,r===s.content)return s;t=!0,n.push(`${s.path}: relaxed strict Children.only usage so multi-child wrappers do not crash the preview.`);const o=r.includes(`function ${v}`)?r:`${r.trimEnd()}
${Cn(s.path)}`;return{...s,content:`${o.trimEnd()}
`}}),changed:t,repairs:n}}function zt(e){let t=!1;const n=[];return{files:e.map(s=>{if(s.type==="folder"){const l=zt(s.children);return l.changed?(t=!0,n.push(...l.repairs),{...s,children:l.files}):s}if(!P.test(s.path))return s;const r=M(s.content,rn),o=M(r.content,an),i=M(o.content,on),c=r.changes+o.changes+i.changes;return c===0?s:(t=!0,n.push(`${s.path}: normalized ${c} generated route literal${c===1?"":"s"} to remove trailing .html suffixes.`),{...s,content:i.content})}),changed:t,repairs:n}}function kt(e){let t=!1;const n=[];return{files:e.map(s=>{if(s.type==="folder"){const p=kt(s.children);return p.changed?(t=!0,n.push(...p.repairs),{...s,children:p.files}):s}if(!P.test(s.path))return s;const r=[...new Set($t(s.path,s.content).filter(p=>p.attribute==="onSubmit").map(p=>p.identifier))];if(r.length===0)return s;const o=/\.tsx?$/i.test(s.path),i=r.map(p=>o?`  const ${p} = (event: { preventDefault: () => void }) => {
    event.preventDefault();
  };`:`  const ${p} = (event) => {
    event.preventDefault();
  };`).join(`

`),c=s.content.replace(It,`$1
${i}
`),l=c===s.content?s.content.replace(Ct,`$1
${i}
`):c;return l===s.content?s:(t=!0,n.push(`${s.path}: added missing form submit handler${r.length===1?"":"s"} (${r.join(", ")}).`),{...s,content:l})}),changed:t,repairs:n}}function On(e){return e&&`${e[0].toLowerCase()}${e.slice(1)}`}function Bt(e){let t=!1;const n=[];return{files:e.map(s=>{var f;if(s.type==="folder"){const g=Bt(s.children);return g.changed?(t=!0,n.push(...g.repairs),{...s,children:g.files}):s}if(!P.test(s.path))return s;const r=(f=s.content.match(st))==null?void 0:f[1];if(!r)return s;const o=s.content.search(st),i=o>=0?s.content.slice(0,o):s.content,c=new RegExp(`\\b(const|let|var)\\s+${r}\\s*=\\s*(\\[|\\{|new\\s+(?:Map|Set)\\b)`,"m"),l=new RegExp(`\\bfunction\\s+${r}\\s*\\(|\\b(?:const|let|var)\\s+${r}\\s*=`,"m");if(!c.test(s.content)&&!l.test(i))return s;const p=c.test(s.content),u=p?`${On(r)}Data`:`${r}Section`;let d=u,m=2;for(;new RegExp(`\\b${d}\\b`).test(s.content);)d=`${u}${m}`,m+=1;let h=s.content;if(p)h=h.replace(c,(g,R,w)=>`${R} ${d} = ${w}`),h=h.replace(new RegExp(`\\b${r}\\b(?=\\s*(?:\\.|\\[))`,"g"),d);else{const g=i.replace(l,R=>R.replace(r,d));h=o>=0?`${g}${s.content.slice(o)}`:g,h=h.replace(new RegExp(`(<\\/?\\s*)${r}\\b`,"g"),`$1${d}`)}return h===s.content?s:(t=!0,n.push(`${s.path}: renamed duplicate ${r} ${p?"data declaration":"component declaration"} to ${d}.`),{...s,content:h})}),changed:t,repairs:n}}function Wt(e,t){return new RegExp(`\\b(?:const|let|var|function|class)\\s+${t}\\b|\\b(?:const|let|var)\\s*\\[[^\\]]*\\b${t}\\b[^\\]]*\\]|\\b(?:const|let|var)\\s*{[^}]*\\b${t}\\b[^}]*}|\\bimport\\s+${t}\\b|\\bimport\\s*{[^}]*\\b${t}\\b[^}]*}\\s+from`,"m").test(e)}function Mn(e){return/\bimport\s+React\b/.test(e)||/\bimport\s+\*\s+as\s+React\s+from\s+["']react["']/.test(e)?e:`import React from "react";
${e}`}function Xt(e){let t=!1;const n=[];return{files:e.map(s=>{if(s.type==="folder"){const p=Xt(s.children);return p.changed?(t=!0,n.push(...p.repairs),{...s,children:p.files}):s}if(!P.test(s.path))return s;const r=[...new Set([...s.content.matchAll(pn)].map(p=>p[1]).filter(p=>{const u=`set${p[0].toUpperCase()}${p.slice(1)}`;return!Wt(s.content,p)&&new RegExp(`\\b${u}\\b`).test(s.content)}))];if(r.length===0)return s;const o=r.map(p=>{const u=`set${p[0].toUpperCase()}${p.slice(1)}`;return`  const [${p}, ${u}] = React.useState("");`}).join(`
`),i=Mn(s.content),c=i.replace(It,`$1
${o}
`),l=c===i?i.replace(Ct,`$1
${o}
`):c;return l===s.content?s:(t=!0,n.push(`${s.path}: added missing controlled input state for ${r.join(", ")}.`),{...s,content:l})}),changed:t,repairs:n}}function Gt(e){let t=!1;const n=[];return{files:e.map(s=>{if(s.type==="folder"){const o=Gt(s.children);return o.changed?(t=!0,n.push(...o.repairs),{...s,children:o.files}):s}if(!P.test(s.path)||!un.test(s.content)||Wt(s.content,"toast"))return s;const r=jt(s.content,s.path,{includeToast:!0,includeUseToast:!1}).replace(/\bexport\s+const\s+toast\b/,"const toast");return r?(t=!0,n.push(`${s.path}: added missing local toast compatibility shim.`),{...s,content:`${r}

${s.content}`}):s}),changed:t,repairs:n}}function Hn(e,t){const n=Lt(e,Dt(e)),a=Sn(n.files,t),s=Ut(a.files),r=zt(s.files),o=yt(r.files),i=Ft(o.files),c=jn(i.files),l=kt(c.files),p=Bt(l.files),u=Xt(p.files),d=Gt(u.files),m=Rn(d.files);return{files:m.files,changed:n.changed||a.changed||s.changed||r.changed||o.changed||i.changed||c.changed||l.changed||p.changed||u.changed||d.changed||m.changed,repairs:[...n.repairs,...a.repairs,...s.repairs,...r.repairs,...o.repairs,...i.repairs,...c.repairs,...l.repairs,...p.repairs,...u.repairs,...d.repairs,...m.repairs]}}function jn(e){const t=y(e).filter(i=>i.type==="file"&&P.test(i.path)),n=new Set(t.map(i=>x(i.path))),a=new Map;for(const i of t)for(const{clause:c,modulePath:l}of vt(i.content)){const p=wn(c),u=p.has("useToast"),d=p.has("toast");if(!u&&!d)continue;const m=In(i.path,l,n);if(!m)continue;const h=a.get(m)||{needsToast:!1,needsUseToast:!1,consumers:new Set};h.needsToast||(h.needsToast=d),h.needsUseToast||(h.needsUseToast=u),h.consumers.add(i.path),a.set(m,h)}if(a.size===0)return{files:e,changed:!1,repairs:[]};let s=!1;const r=[],o=i=>i.map(c=>{if(c.type==="folder")return{...c,children:o(c.children)};if(!P.test(c.path))return c;const l=x(c.path),p=a.get(l);if(!p)return c;const u=p.needsUseToast&&!ct(c.content,"useToast"),d=p.needsToast&&!ct(c.content,"toast");if(!u&&!d)return c;s=!0,r.push(`${c.path}: added missing toast compatibility export${u&&d?"s (toast, useToast)":u?" (useToast)":" (toast)"} for ${[...p.consumers].join(", ")}`);const m=jt(c.content,c.path,{includeToast:d,includeUseToast:u});return{...c,content:`${c.content.trimEnd()}

${m}
`}});return{files:o(e),changed:s,repairs:r}}export{kn as a,Xn as b,zn as c,Un as d,Wn as e,Bn as f,Ln as g,Hn as r,Gn as v};
