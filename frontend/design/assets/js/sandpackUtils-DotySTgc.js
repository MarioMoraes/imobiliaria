const A="src/lib/auraCms.js",E="AURA_CMS_COLLECTION_REQUEST",y="AURA_CMS_COLLECTION_RESPONSE",S=({})=>`import { useEffect, useState } from "react";

const AURA_CMS_COLLECTION_REQUEST_TYPE = ${JSON.stringify(E)};
const AURA_CMS_COLLECTION_RESPONSE_TYPE = ${JSON.stringify(y)};
const AURA_CMS_REQUEST_TIMEOUT_MS = 15000;
const PLACEHOLDER_CMS_IMAGE_HOST_PATTERN = /https?:\\/\\/images\\.example\\.com\\//i;
const cmsCollectionCache = new Map();
const cmsCollectionInflightRequests = new Map();

const isPlaceholderCmsImageUrl = (value) =>
  typeof value === "string" && PLACEHOLDER_CMS_IMAGE_HOST_PATTERN.test(value);

const buildFallbackCmsImageUrl = (key, itemData = {}) => {
  const identity =
    itemData.slug ||
    itemData.name ||
    itemData.title ||
    itemData.label ||
    itemData.id ||
    "cms-item";

  if (/(avatar|headshot|profile|photo)/i.test(key)) {
    return \`https://i.pravatar.cc/240?u=\${encodeURIComponent(String(identity))}\`;
  }

  const label =
    itemData.title || itemData.name || itemData.label || itemData.slug || "Image";

  return \`https://placehold.co/600x400/0f172a/ffffff?text=\${encodeURIComponent(
    String(label),
  )}\`;
};

const normalizeCollectionItems = (items) =>
  (items || []).map((item) => {
    const sourceData = item.data || {};
    const normalizedData = Object.fromEntries(
      Object.entries(sourceData).map(([key, value]) => [
        key,
        isPlaceholderCmsImageUrl(value)
          ? buildFallbackCmsImageUrl(key, {
              ...sourceData,
              id: item.id,
            })
          : value,
      ]),
    );

    return {
      id: item.id,
      isPublished: item.is_published !== false,
      ...normalizedData,
    };
  });

const requestAuraCMSCollection = (collectionSlug, options = {}) => {
  if (typeof window === "undefined") {
    return Promise.resolve([]);
  }

  if (!window.parent || window.parent === window) {
    return Promise.reject(
      new Error("Aura CMS is only available inside the Aura preview runtime."),
    );
  }

  const requestId = \`aura-cms-\${Date.now().toString(36)}-\${Math.random()
    .toString(36)
    .slice(2, 10)}\`;

  return new Promise((resolve, reject) => {
    let timeoutId = null;

    const cleanup = () => {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      window.removeEventListener("message", handleMessage);
    };

    const handleMessage = (event) => {
      if (event.source !== window.parent) {
        return;
      }

      const message = event.data;
      if (
        !message ||
        message.type !== AURA_CMS_COLLECTION_RESPONSE_TYPE ||
        message.requestId !== requestId
      ) {
        return;
      }

      cleanup();

      if (message.error) {
        reject(new Error(message.error));
        return;
      }

      resolve(Array.isArray(message.items) ? message.items : []);
    };

    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Aura CMS bridge timed out."));
    }, AURA_CMS_REQUEST_TIMEOUT_MS);

    window.addEventListener("message", handleMessage);
    window.parent.postMessage(
      {
        type: AURA_CMS_COLLECTION_REQUEST_TYPE,
        requestId,
        collectionSlug,
        publishedOnly: options.publishedOnly === true,
      },
      "*",
    );
  });
};

export const fetchAuraCMSCollection = async (collectionSlug, options = {}) => {
  const cacheKey = \`\${String(collectionSlug || "").trim().toLowerCase()}::\${options.publishedOnly === true ? "published" : "draft"}\`;

  if (cmsCollectionCache.has(cacheKey)) {
    return cmsCollectionCache.get(cacheKey);
  }

  if (cmsCollectionInflightRequests.has(cacheKey)) {
    return cmsCollectionInflightRequests.get(cacheKey);
  }

  const request = requestAuraCMSCollection(collectionSlug, options)
    .then((items) => normalizeCollectionItems(items))
    .then((items) => {
      cmsCollectionCache.set(cacheKey, items);
      return items;
    })
    .finally(() => {
      cmsCollectionInflightRequests.delete(cacheKey);
    });

  cmsCollectionInflightRequests.set(cacheKey, request);
  return request;
};

export const useAuraCMSCollection = (collectionSlug, options = {}) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isActive = true;

    const loadCollection = async () => {
      setLoading(true);
      setError(null);

      try {
        const nextItems = await fetchAuraCMSCollection(collectionSlug, options);
        if (!isActive) {
          return;
        }

        setItems(nextItems);
      } catch (loadError) {
        if (!isActive) {
          return;
        }

        setItems([]);
        setError(loadError instanceof Error ? loadError : new Error("Failed to load CMS collection."));
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    loadCollection();

    return () => {
      isActive = false;
    };
  }, [collectionSlug, options.publishedOnly]);

  const featuredItems = items.filter((item) => item?.featured);

  return {
    items,
    featuredItems,
    loading,
    error,
  };
};
`,_=({files:n,cmsProjectId:l})=>{const e=n.findIndex(c=>c.type==="file"&&c.path===A);if(!l&&e<0)return{files:n,changed:!1};const r=S({});if(e>=0){const c=n[e];if(c.content===r)return{files:n,changed:!1};const i=[...n];return i[e]={...c,content:r},{files:i,changed:!0}}return{files:[...n,{name:"auraCms.js",path:A,content:r,type:"file"}],changed:!0}};function I(n){const l=n.some(i=>i.path==="vite.config.js"||i.path==="vite.config.ts"),e=n.some(i=>i.path==="next.config.js"||i.path==="app/layout.tsx"),r=n.some(i=>i.path==="public/index.html"),c=n.some(i=>i.path==="index.html");return e?"nextjs":l||c?"react-vite":r?"react-cra":"react-vite"}function R(n){var u,d,m,h,f,g;if(!n.some(t=>t.path==="app/layout.tsx"||t.path==="next.config.js"))return n;const e=[],r=n.find(t=>t.path==="package.json");if(r&&r.type==="file")try{const t=JSON.parse(r.content),p={...t,scripts:{start:"react-scripts start",build:"react-scripts build",test:"react-scripts test",eject:"react-scripts eject"},dependencies:{react:"^18.2.0","react-dom":"^18.2.0",clsx:((u=t.dependencies)==null?void 0:u.clsx)||"^2.1.0","tailwind-merge":((d=t.dependencies)==null?void 0:d["tailwind-merge"])||"^2.2.0","class-variance-authority":((m=t.dependencies)==null?void 0:m["class-variance-authority"])||"^0.7.0","lucide-react":((h=t.dependencies)==null?void 0:h["lucide-react"])||"^0.363.0","@iconify/react":((f=t.dependencies)==null?void 0:f["@iconify/react"])||"^6.0.2","@radix-ui/react-slot":((g=t.dependencies)==null?void 0:g["@radix-ui/react-slot"])||"^1.0.2","web-vitals":"^2.1.4"},devDependencies:{tailwindcss:"^3.4.1",autoprefixer:"^10.4.19",postcss:"^8.4.38"}};e.push({name:"package.json",type:"file",path:"package.json",content:JSON.stringify(p,null,2)})}catch{}const c=n.find(t=>t.path==="app/layout.tsx");if(c&&c.type==="file"){let t="React App",p="React App";const x=c.content.match(/title:\s*['"]([^'"]*)['"]/),C=c.content.match(/description:\s*['"]([^'"]*)['"]/);x&&(t=x[1]),C&&(p=C[1]),e.push({name:"index.html",type:"file",path:"public/index.html",content:`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="%PUBLIC_URL%/favicon.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#000000" />
    <meta name="description" content="${p}" />
    <title>${t}</title>
  </head>
  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <div id="root"></div>
  </body>
</html>`})}e.push({name:"index.tsx",type:"file",path:"src/index.tsx",content:`import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`});const i=n.find(t=>t.path==="app/page.tsx");if(i&&i.type==="file"){let t=i.content;t=t.replace(/['"]use client['"]/g,""),t=t.replace(/export default function Home\(\)/g,"function App()"),t=t.replace(/export default function Page\(\)/g,"function App()"),t.includes("export default App")||(t+=`

export default App;`),t=t.replace(/<main([^>]*)>/g,'<div className="App"$1>'),t=t.replace(/<\/main>/g,"</div>"),e.push({name:"App.tsx",type:"file",path:"src/App.tsx",content:t})}const a=n.find(t=>t.path==="app/globals.css");a&&a.type==="file"&&e.push({name:"index.css",type:"file",path:"src/index.css",content:a.content}),n.forEach(t=>{if(t.type==="file"&&t.path.startsWith("components/")){let p=t.content;p=p.replace(/['"]use client['"]/g,""),p=p.replace(/@\/components\/ui\//g,"./ui/"),p=p.replace(/@\/lib\//g,"../lib/"),e.push({...t,path:`src/${t.path}`})}}),n.forEach(t=>{t.type==="file"&&t.path.startsWith("lib/")&&e.push({...t,path:`src/${t.path}`})});const o=n.find(t=>t.path==="tailwind.config.ts");if(o){let t=o.content;t=t.replace(/'.\/(pages|components|app|lib)\/\*\*\/\*\.\{ts,tsx\}'/g,"'./src/**/*.{js,jsx,ts,tsx}'"),t=t.replace(/'.\/(pages|components|app|lib)\/\*\*\/\*\.\{ts,tsx\}',/g,`'./src/**/*.{js,jsx,ts,tsx}',
    './public/index.html',`),e.push({...o,content:t})}const s=n.find(t=>t.path==="postcss.config.js");return s&&e.push(s),e}function M(n){const l=v(n);let e;e=n,l==="vite-react"&&!e.some(a=>a.path==="vite.config.js"||a.path==="vite.config.ts")&&(e=[...e,{name:"vite.config.js",type:"file",path:"vite.config.js",content:`import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
})`,children:[]}]);const r={};function c(a){if(a.type==="file"){if(a.path==="/App.js"&&e.some(s=>s.path==="src/App.js"&&s.content.length>500)||a.path==="App.js"&&e.some(s=>s.path==="src/App.js"&&s.content.length>500)||a.path==="/index.js"&&e.some(s=>s.path==="src/index.js"&&s.content.length>200)||a.path==="index.js"&&e.some(s=>s.path==="src/index.js"&&s.content.length>200)||a.content.length<50&&a.path.includes("App")&&e.some(s=>s.path.includes("App")&&s.content.length>500&&s.path!==a.path))return;r[a.path]={code:a.content,readOnly:!1}}else a.type==="folder"&&a.children&&a.children.forEach(c)}e.forEach(c);const i=j(n);return r[i]||["src/App.jsx","src/App.js","src/App.tsx"].find(o=>r[o]),r}function v(n){return n.map(e=>e.path),n.some(e=>e.path==="app/layout.tsx"||e.path==="next.config.js"||e.path==="pages/_app.js")?"nextjs":n.some(e=>e.path==="vite.config.js"||e.path==="vite.config.ts")?n.some(e=>e.path.includes(".vue"))?"vite-vue":n.some(e=>e.path.includes(".svelte"))?"vite-svelte":"vite-react":(n.some(e=>e.path==="src/index.js"||e.path==="src/App.js")||n.some(e=>e.path.endsWith(".jsx")||e.path.endsWith(".tsx")),"react")}function j(n){switch(v(n)){case"vite-react":const e=["src/App.jsx","src/App.tsx","src/main.jsx","src/main.tsx"];for(const o of e)if(n.some(s=>s.path===o))return o;return"src/App.jsx";case"vite-vue":const r=["src/App.vue","src/main.js","src/main.ts"];for(const o of r)if(n.some(s=>s.path===o))return o;return"src/App.vue";case"vite-svelte":const c=["src/App.svelte","src/main.js","src/main.ts"];for(const o of c)if(n.some(s=>s.path===o))return o;return"src/App.svelte";case"nextjs":const i=["app/page.tsx","app/page.js","pages/index.tsx","pages/index.js"];for(const o of i)if(n.some(s=>s.path===o))return o;return"app/page.tsx";default:const a=["src/App.js","src/App.jsx","src/App.tsx","src/index.js","src/index.tsx"];for(const o of a)if(n.some(s=>s.path===o))return o;return"src/App.js"}}export{E as A,M as a,j as b,R as c,I as d,_ as e,y as f,v as g};
