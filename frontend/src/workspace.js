import {mountAnalysis} from './analysis.js';

const app = document.querySelector('#app');
const records = document.querySelector('#records-view');
const analysis = document.querySelector('#analysis-view');
const buttons = document.querySelectorAll('[data-view]');
let analysisMounted = false;
buttons.forEach(button => {
  button.onclick = () => {
    const view = button.dataset.view;
    app.hidden = view !== 'game';
    records.hidden = view !== 'records';
    analysis.hidden = view !== 'analysis';
    buttons.forEach(item => item.setAttribute('aria-pressed',String(item === button)));
    if (view === 'records') {
      const frame = document.querySelector('#records-frame');
      if (!frame.getAttribute('src')) frame.src = '/admin.html?embedded=1';
    }
    if (view === 'analysis' && !analysisMounted) {
      mountAnalysis(analysis);
      analysisMounted = true;
    }
  };
});
