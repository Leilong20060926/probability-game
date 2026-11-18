import { mountRouteAnalysis } from './route-analysis-view.js';
import { mountFeedbackList } from './feedback.js';

const app = document.querySelector('#app');
const records = document.querySelector('#records-view');
const analysis = document.querySelector('#analysis-view');
const feedback = document.querySelector('#feedback-view');

let analysisMounted = false, feedbackList = null;

document.querySelectorAll('[data-view]').forEach(button => {
  button.onclick = () => {
    const view = button.dataset.view;

    app.hidden = view !== 'game';
    records.hidden = view !== 'records';
    analysis.hidden = view !== 'analysis';
    feedback.hidden = view !== 'feedback';

    document.querySelectorAll('[data-view]').forEach(item => {
      item.setAttribute('aria-pressed', String(item === button));
    });

    if (view === 'records') {
      const frame = document.querySelector('#records-frame');
      if (!frame.getAttribute('src')) {
        frame.src = '/admin.html?embedded=1';
      }
    }

    if (view === 'analysis' && !analysisMounted) {
      mountRouteAnalysis(analysis);
      analysisMounted = true;
    }

    if (view === 'feedback') {
      if (!feedbackList) feedbackList = mountFeedbackList(feedback);
      else feedbackList.refresh();
    }
  };
});