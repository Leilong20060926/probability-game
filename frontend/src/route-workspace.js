import {mountRouteAnalysis} from './route-analysis-view.js';
const app=document.querySelector('#app'),records=document.querySelector('#records-view'),analysis=document.querySelector('#analysis-view');
let analysisMounted=false;
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{
  const view=button.dataset.view;
  app.hidden=view!=='game';records.hidden=view!=='records';analysis.hidden=view!=='analysis';
  document.querySelectorAll('[data-view]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  if(view==='records'){const frame=document.querySelector('#records-frame');if(!frame.getAttribute('src'))frame.src='/admin.html?embedded=1';}
  if(view==='analysis' && !analysisMounted){mountRouteAnalysis(analysis);analysisMounted=true;}
});
